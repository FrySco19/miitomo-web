#!/usr/bin/env python3
"""Disassemble an exported ARM/Thumb function from an ELF32 .so, annotating literal-pool loads
with pointed-to C strings. Usage: disfunc.py <lib.so> <symbol|0xaddr> [nbytes]"""
import sys, lief, capstone, re
from capstone import arm
b=lief.parse(sys.argv[1]); data=open(sys.argv[1],'rb').read()
def v2o(va):
    for s in b.segments:
        if s.type==lief.ELF.Segment.TYPE.LOAD and s.virtual_address<=va<s.virtual_address+s.physical_size:
            return va-s.virtual_address+s.file_offset
def cstr(va):
    o=v2o(va)
    if o is None: return None
    e=data.find(b'\0',o,o+300); s=data[o:e]
    return s.decode('latin1') if len(s)>=3 and all(32<=c<127 for c in s) else None
def u32(va):
    o=v2o(va); return int.from_bytes(data[o:o+4],'little') if o is not None else None
t=sys.argv[2]; size=None
if t.startswith('0x'): addr=int(t,16)
else:
    sym=next(s for s in b.dynamic_symbols if s.name==t); addr=sym.value; size=sym.size
size=int(sys.argv[3],0) if len(sys.argv)>3 else (size or 128)
thumb=addr&1; addr&=~1
md=capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB if thumb else capstone.CS_MODE_ARM); md.detail=True
o=v2o(addr)
for i in md.disasm(data[o:o+size],addr):
    note=''
    if i.mnemonic.startswith('ldr') and len(i.operands)==2 and i.operands[1].type==arm.ARM_OP_MEM and i.operands[1].mem.base==arm.ARM_REG_PC:
        lit=((i.address+4)&~3)+i.operands[1].mem.disp; val=u32(lit); note=f' ; [{lit:#x}]={val:#x}' if val is not None else ''
    print(f'{i.address:08x}: {i.mnemonic:8} {i.op_str}{note}')
