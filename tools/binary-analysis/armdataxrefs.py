#!/usr/bin/env python3
"""ARM-mode PIC data xrefs: 'ldr Rm,[pc,#imm]' ... 'add Rd, pc, Rm' (or 'add Rd, Rm, pc') -> target = lit + addr(add) + 8.
Usage: armdataxrefs.py lib.so 0xlo 0xhi   (reports every xref whose target is in [lo,hi))"""
import sys, struct, lief
p=sys.argv[1]; lo=int(sys.argv[2],16); hi=int(sys.argv[3],16)
d=open(p,'rb').read(); b=lief.parse(p); t=b.get_section('.text'); o0=t.file_offset; va0=t.virtual_address
for off in range(0,t.size-4,4):
    w=struct.unpack_from('<I',d,o0+off)[0]
    if (w&0x0fe00010)!=0x00800000: continue           # ADD (register), no shift by reg
    rn=(w>>16)&15; rm=w&15; rd=(w>>12)&15
    if rn==15: src=rm
    elif rm==15: src=rn
    else: continue
    a=va0+off
    for back in range(4,64,4):
        w2=struct.unpack_from('<I',d,o0+off-back)[0]
        if (w2&0x0f7f0000)==0x051f0000 and ((w2>>12)&15)==src:
            imm=w2&0xfff; lit=a-back+8+(imm if (w2>>23)&1 else -imm)
            v=struct.unpack_from('<I',d,lit)[0]; tgt=(v+a+8)&0xffffffff
            if lo<=tgt<hi: print(f'{a:#x} -> {tgt:#x}')
            break
