#!/usr/bin/env python3
"""Linear ARM-mode scan of an address range: annotates bl targets with exported symbol names (demangled),
literal-pool floats and GOT/PIC-resolved strings. Usage: armscan.py lib.so 0xstart 0xend [--only-notes]"""
import sys, struct, subprocess, bisect, capstone, lief
from capstone import arm
p=sys.argv[1]; s0=int(sys.argv[2],16); s1=int(sys.argv[3],16); only='--only-notes' in sys.argv
d=open(p,'rb').read(); b=lief.parse(p)
GOT=[e.value for e in b.dynamic_entries if e.tag==lief.ELF.DynamicEntry.TAG.PLTGOT][0]
syms={}
for s in b.dynamic_symbols:
    if s.is_function and s.value: syms[s.value&~1]=s.name
for r in b.pltgot_relocations:
    if r.has_symbol: pass
names=sorted(syms); 
def dem(n):
    try: return subprocess.run(['c++filt',n],capture_output=True,text=True).stdout.strip()
    except Exception: return n
cache={}
def symname(a):
    if a in syms:
        if a not in cache: cache[a]=dem(syms[a])
        return cache[a]
    return None
def cstr(va):
    if 0x1880ee0<=va<0x1aa0b24:
        e=d.find(b'\0',va); s=d[va:e]
        if 2<len(s)<80 and all(32<=c<127 for c in s): return s.decode()
md=capstone.Cs(capstone.CS_ARCH_ARM,capstone.CS_MODE_ARM); md.detail=True; md.skipdata=True
regs={}
for i in md.disasm(d[s0:s1],s0):
    note=''
    if i.mnemonic in('bl','blx','b') and i.op_str.startswith('#'):
        t=int(i.op_str[1:],16); n=symname(t)
        if n: note=' ; '+n[:110]
    if i.mnemonic.startswith('ldr') and i.mnemonic not in ('ldrd',) and len(i.operands)==2 and i.operands[1].type==arm.ARM_OP_MEM and i.operands[1].mem.base==arm.ARM_REG_PC and i.operands[1].mem.index==0:
        lit=i.address+8+i.operands[1].mem.disp
        if 0<=lit<len(d)-4:
            v=struct.unpack_from('<I',d,lit)[0]; f=struct.unpack('<f',struct.pack('<I',v))[0]
            g=(GOT+v)&0xffffffff; sg=cstr(g)
            note=f' ; lit={v:#x}'+(f' f={f:.6g}' if 1e-6<abs(f)<1e6 else '')+(f' str="{sg}"' if sg else '')
    if i.mnemonic.startswith('vldr') and 'pc' in i.op_str:
        lit=i.address+8+i.operands[1].mem.disp
        v=struct.unpack_from('<I',d,lit)[0]; f=struct.unpack('<f',struct.pack('<I',v))[0]; note=f' ; f={f:.6g}'
    if i.mnemonic in ('vmov.f32','vmov') and '#' in i.op_str: note=' ; imm'
    if not only or note: print(f'{i.address:x}: {i.mnemonic:8} {i.op_str}{note}')
