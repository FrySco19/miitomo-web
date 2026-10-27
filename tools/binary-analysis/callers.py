#!/usr/bin/env python3
"""Find direct callers (ARM BL/BLX imm and Thumb-2 BL/BLX) of target addresses in .text.
Usage: callers.py lib.so 0xtarget[...]   (thumb targets may be given with the low bit set)"""
import sys, struct, lief
p=sys.argv[1]; d=open(p,'rb').read(); b=lief.parse(p)
t=b.get_section('.text'); o0=t.file_offset; va0=t.virtual_address; n=t.size
T={int(x,16)&~1:x for x in sys.argv[2:]}
def sx(v,bits): return v-(1<<bits) if v&(1<<(bits-1)) else v
res=[]
for off in range(0,n-4,4):   # ARM
    w=struct.unpack_from('<I',d,o0+off)[0]; pc=va0+off+8
    if (w>>25)==0b1111101: tgt=pc+(sx(w&0xffffff,24)<<2)+(((w>>24)&1)<<1); kind='arm-blx'
    elif ((w>>24)&0xf)==0b1011 and (w>>28)!=0xf: tgt=pc+(sx(w&0xffffff,24)<<2); kind='arm-bl'
    else: continue
    if tgt&~1 in T: res.append((va0+off,kind,T[tgt&~1]))
for off in range(0,n-4,2):   # Thumb
    h1,h2=struct.unpack_from('<HH',d,o0+off)
    if (h1>>11)!=0b11110 or (h2>>14)!=0b11: continue
    S=(h1>>10)&1; imm10=h1&0x3ff; J1=(h2>>13)&1; J2=(h2>>11)&1; imm11=h2&0x7ff
    I1=1-(J1^S); I2=1-(J2^S)
    if (h2>>12)&1: off32=sx((S<<24)|(I1<<23)|(I2<<22)|(imm10<<12)|(imm11<<1),25); tgt=va0+off+4+off32; kind='thumb-bl'
    else: off32=sx((S<<24)|(I1<<23)|(I2<<22)|(imm10<<12)|((imm11>>1)<<2),25); tgt=((va0+off+4)&~3)+off32; kind='thumb-blx'
    if tgt&~1 in T: res.append((va0+off,kind,T[tgt&~1]))
for a,k,t in sorted(res): print(f'{a:#x} {k:9} -> {t}')
