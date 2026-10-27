# find Thumb BL/BLX instructions in [lo,hi) whose target is T (direct calls)
import sys,struct
from elftools.elf.elffile import ELFFile
data=open(sys.argv[1],'rb').read(); elf=ELFFile(open(sys.argv[1],'rb'))
segs=[(s['p_vaddr'],s['p_offset'],s['p_filesz']) for s in elf.iter_segments() if s['p_type']=='PT_LOAD']
def off(v):
    for va,po,sz in segs:
        if va<=v<va+sz: return po+v-va
lo,hi=int(sys.argv[2],16),int(sys.argv[3],16); targets={int(t,16) for t in sys.argv[4:]}
o=off(lo)
for a in range(lo,hi,2):
    h1,h2=struct.unpack_from('<HH',data,off(a))
    if (h1&0xf800)==0xf000 and (h2&0xc000)==0xc000:
        S=(h1>>10)&1; imm10=h1&0x3ff; J1=(h2>>13)&1; J2=(h2>>11)&1; imm11=h2&0x7ff
        I1=1-(J1^S); I2=1-(J2^S)
        imm=(S<<24)|(I1<<23)|(I2<<22)|(imm10<<12)|(imm11<<1)
        if S: imm-=1<<25
        blx=(h2&0x1000)==0
        t=(a+4+imm)&(~3 if blx else ~0)
        if t in targets: print(hex(a),'->',hex(t),'blx' if blx else 'bl')
