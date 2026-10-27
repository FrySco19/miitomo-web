#!/usr/bin/env python3
"""Find Thumb code that materialises a data address via the PIC idiom
   ldr Rd, [pc, #imm] ... add Rd, pc   (target = literal + addr(add) + 4).
Usage: dataxrefs.py <lib.so> <0xtarget> [0xtarget...]   -> prints xref sites + containing exported symbol."""
import sys, struct, bisect, lief
p=sys.argv[1]; d=open(p,'rb').read(); b=lief.parse(p)
targets={int(t,16) for t in sys.argv[2:]}
t=b.get_section('.text'); o0=t.file_offset; va0=t.virtual_address; n=t.size
funcs=sorted((s.value&~1,s.size,s.name) for s in b.dynamic_symbols if s.is_function and s.value)
starts=[f[0] for f in funcs]
hits=[]
for off in range(0,n-2,2):
    hw=struct.unpack_from('<H',d,o0+off)[0]
    if (hw & 0xff78)==0x4478:      # add Rdn, pc  (0100 0100 D111 1ddd)
        rd=(hw&7)|((hw>>4)&8); addaddr=va0+off
        for back in range(2,40,2):
            h2=struct.unpack_from('<H',d,o0+off-back)[0]
            lit=None
            if rd<8 and (h2>>11)==0b01001 and ((h2>>8)&7)==rd:  # ldr Rd,[pc,#imm8*4]
                ins=addaddr-back; lit=((ins+4)&~3)+(h2&0xff)*4
            elif back>=4:
                h1=struct.unpack_from('<H',d,o0+off-back)[0]; h3=struct.unpack_from('<H',d,o0+off-back+2)[0]
                if h1 in (0xf8df,0xf85f) and (h3>>12)==rd:   # ldr.w Rt,[pc,#+/-imm12]
                    ins=addaddr-back; imm=h3&0xfff; lit=((ins+4)&~3)+(imm if h1==0xf8df else -imm)
            if lit is not None:
                lo=lit-(va0-o0)
                if 0<=lo<len(d)-4:
                    val=struct.unpack_from('<I',d,lo)[0]
                    tgt=(val+addaddr+4)&0xffffffff
                    if tgt in targets: hits.append((addaddr,tgt))
                break
for a,tg in hits:
    i=bisect.bisect_right(starts,a)-1
    f=funcs[i] if i>=0 and a<funcs[i][0]+max(funcs[i][1],1)+0x4000 else None
    print(f'{a:#x} -> {tg:#x}  in {f[2] if f else "?"} (+{a-f[0]:#x})' if f else f'{a:#x} -> {tg:#x}')
