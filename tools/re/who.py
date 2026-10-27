# find ARM 'ldr rX,[pc,#imm]' instructions that load from a given literal address
import sys,struct
from elftools.elf.elffile import ELFFile
data=open(sys.argv[1],'rb').read(); elf=ELFFile(open(sys.argv[1],'rb'))
segs=[(s['p_vaddr'],s['p_offset'],s['p_filesz']) for s in elf.iter_segments() if s['p_type']=='PT_LOAD']
def va2off(v):
    for va,po,sz in segs:
        if va<=v<va+sz: return po+v-va
for t in sys.argv[2:]:
    lit=int(t,16)
    for a in range(lit-4096, lit, 4):
        w=struct.unpack('<I',data[va2off(a):va2off(a)+4])[0]
        if (w & 0x0f7f0000)==0x051f0000:  # LDR Rt,[PC,#±imm12]
            imm=w&0xfff; up=(w>>23)&1
            if (a+8+(imm if up else -imm))==lit: print(t,'<-',hex(a))
