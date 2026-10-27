import sys,struct
from elftools.elf.elffile import ELFFile
GOT=0x1b6cea4
f=open(sys.argv[1],'rb'); data=f.read(); elf=ELFFile(open(sys.argv[1],'rb'))
segs=[(s['p_vaddr'],s['p_offset'],s['p_filesz']) for s in elf.iter_segments() if s['p_type']=='PT_LOAD']
def off2va(o):
    for va,po,sz in segs:
        if po<=o<po+sz: return va+o-po
def va2off(v):
    for va,po,sz in segs:
        if va<=v<va+sz: return po+v-va
for s in sys.argv[2:]:
    b=s.encode()+b'\0'; i=data.find(b'\0'+b)
    while i>=0:
        va=off2va(i+1); lit=(va-GOT)&0xffffffff
        refs=[]; p=data.find(struct.pack('<I',lit))
        while p>=0: refs.append(hex(off2va(p))); p=data.find(struct.pack('<I',lit),p+1)
        refs2=[]; p=data.find(struct.pack('<I',va))
        while p>=0: refs2.append(hex(off2va(p))); p=data.find(struct.pack('<I',va),p+1)
        print(s, 'va',hex(va),'gotoff-refs',refs,'abs-refs',refs2[:8])
        i=data.find(b'\0'+b,i+1)
