#!/usr/bin/env python3
"""Emulate an ARM/Thumb function from an ELF32 .so with Unicorn. Imported functions are resolved
to Python stubs (memcpy/memset/strlen/malloc/...); unknown imports abort with their name.
Usage: emu_call.py <lib.so> <addr (thumb bit set)> <arg0> [arg1..arg3]"""
import sys, lief
from unicorn import *; from unicorn.arm_const import *
p=sys.argv[1]; b=lief.parse(p); data=open(p,'rb').read()
mu=Uc(UC_ARCH_ARM, UC_MODE_THUMB)
hi=max(s.virtual_address+s.virtual_size for s in b.segments if s.type==lief.ELF.Segment.TYPE.LOAD)
size=(hi+0xfff)&~0xfff; mu.mem_map(0,size)
for s in b.segments:
    if s.type==lief.ELF.Segment.TYPE.LOAD:
        mu.mem_write(s.virtual_address,data[s.file_offset:s.file_offset+s.physical_size])
STUB=0x30000000; mu.mem_map(STUB,0x10000); HEAP=0x40000000; mu.mem_map(HEAP,0x400000); heap=[HEAP]
STACK=0x10000000; mu.mem_map(STACK,0x100000); RET=0x20000000; mu.mem_map(RET,0x1000)
G=0x50000000; mu.mem_map(G,0x1000)  # fake data for imported objects (e.g. __stack_chk_guard)
names={}
for i,r in enumerate(b.relocations):
    if not r.has_symbol: continue
    n=r.symbol.name
    if r.symbol.is_function or r.type in (lief.ELF.Relocation.TYPE.ARM_JUMP_SLOT,):
        a=STUB+len(names)*4; names[a]=n; mu.mem_write(r.address,(a|1).to_bytes(4,'little'))
    elif r.symbol.value==0:
        mu.mem_write(r.address,G.to_bytes(4,'little'))
    else:
        mu.mem_write(r.address,(r.symbol.value+r.addend).to_bytes(4,'little'))
# R_ARM_RELATIVE: base 0 -> value already correct
rd=lambda r:mu.reg_read(r)
def cs(a): return bytes(mu.mem_read(a,4096)).split(b'\0')[0]
def stub(uc,addr,sz,u):
    n=names.get(addr&~1)
    if n is None: return
    a0,a1,a2=rd(UC_ARM_REG_R0),rd(UC_ARM_REG_R1),rd(UC_ARM_REG_R2); ret=0
    if n in('memcpy','memmove','__aeabi_memcpy','__aeabi_memmove','__aeabi_memcpy4','__aeabi_memcpy8'):
        uc.mem_write(a0,bytes(uc.mem_read(a1,a2))); ret=a0
    elif n in('memset',): uc.mem_write(a0,bytes([a1&0xff])*a2); ret=a0
    elif n in('__aeabi_memset','__aeabi_memset4','__aeabi_memset8'): uc.mem_write(a0,bytes([a2&0xff])*a1)
    elif n in('__aeabi_memclr','__aeabi_memclr4','__aeabi_memclr8'): uc.mem_write(a0,b'\0'*a1)
    elif n=='strlen': ret=len(cs(a0))
    elif n in('malloc','_Znwj','_Znaj','calloc'):
        sz2=a0*a1 if n=='calloc' else a0; ret=heap[0]; heap[0]+=(sz2+15)&~15; uc.mem_write(ret,b'\0'*sz2)
    elif n in('free','_ZdlPv','_ZdaPv','__stack_chk_fail','__cxa_finalize'): pass
    elif n in('strncmp','strcmp','memcmp'):
        L=a2 if n!='strcmp' else 4096
        x=bytes(uc.mem_read(a0,L)); y=bytes(uc.mem_read(a1,L))
        if n!='memcmp': x=x.split(b'\0')[0]; y=y.split(b'\0')[0]; x=x[:L]; y=y[:L]
        ret=0 if x==y else (1 if x>y else 0xffffffff)
    elif n=='strcpy': uc.mem_write(a0,cs(a1)+b'\0'); ret=a0
    else: print('UNHANDLED IMPORT',n); uc.emu_stop(); return
    uc.reg_write(UC_ARM_REG_R0,ret); uc.reg_write(UC_ARM_REG_PC,rd(UC_ARM_REG_LR))
mu.hook_add(UC_HOOK_CODE,stub,begin=STUB,end=STUB+0x10000)
mu.reg_write(UC_ARM_REG_SP,STACK+0xff000); mu.reg_write(UC_ARM_REG_LR,RET|1)
for i,a in enumerate(sys.argv[3:7]): mu.reg_write([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3][i],int(a,0))
try: mu.emu_start(int(sys.argv[2],0), RET, count=5_000_000)
except UcError as e: print('ERR',e,'pc=%#x'%rd(UC_ARM_REG_PC)); sys.exit(1)
r0=rd(UC_ARM_REG_R0)
try: s=cs(r0)
except Exception: s=b''
print(f'arg={sys.argv[3]} r0={r0:#x} str={s!r}')
