#!/usr/bin/env python3
"""Map ARM PLT stubs to their symbols (stub: add ip,pc,#a ; add ip,ip,#b ; ldr pc,[ip,#c]!).
Usage: pltmap.py lib.so [name-substring...]  -> 'stubaddr symbol'"""
import sys, struct, lief, subprocess
p=sys.argv[1]; d=open(p,'rb').read(); b=lief.parse(p)
plt=b.get_section('.plt'); o=plt.file_offset; va=plt.virtual_address
slot2sym={r.address:r.symbol.name for r in b.pltgot_relocations if r.has_symbol}
def rot(imm12): r=(imm12>>8)*2; v=imm12&0xff; return ((v>>r)|(v<<(32-r)))&0xffffffff
out=[]
for k in range(20, plt.size-12, 4):
    w1,w2,w3=struct.unpack_from('<III',d,o+k)
    if (w1&0xfffff000)==0xe28fc000 and (w2&0xfffff000)==0xe28cc000 and (w3&0xfffff000)==0xe5bcf000:
        slot=(va+k+8+rot(w1&0xfff)+rot(w2&0xfff)+(w3&0xfff))&0xffffffff
        out.append((va+k,slot2sym.get(slot,f'?{slot:#x}')))
flt=sys.argv[2:]
for a,s in out:
    if not flt or any(f in s for f in flt): print(f'{a:#x} {s}')
