#!/usr/bin/env python3
"""Find Thumb/ARM direct branch xrefs (bl/blx/b.w) to a target in .text. Usage: xrefs.py <lib.so> <0xtarget>"""
import sys, lief, capstone
b=lief.parse(sys.argv[1]); data=open(sys.argv[1],'rb').read(); tgt=int(sys.argv[2],16)&~1
t=b.get_section('.text'); o=t.file_offset; va=t.virtual_address; code=data[o:o+t.size]
md=capstone.Cs(capstone.CS_ARCH_ARM,capstone.CS_MODE_THUMB); md.skipdata=True
hits=set()
for i in md.disasm(code,va):
    if i.mnemonic in('bl','blx','b.w','b') and i.op_str==f'#{tgt:#x}': hits.add(i.address)
for h in sorted(hits): print(f'{h:#x}')
