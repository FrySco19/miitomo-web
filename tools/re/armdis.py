import sys,struct,re
from capstone import *
from elftools.elf.elffile import ELFFile
GOT=0x1b6cea4
data=open(sys.argv[1],'rb').read(); elf=ELFFile(open(sys.argv[1],'rb'))
segs=[(s['p_vaddr'],s['p_offset'],s['p_filesz']) for s in elf.iter_segments() if s['p_type']=='PT_LOAD']
def va2off(v):
    for va,po,sz in segs:
        if va<=v<va+sz: return po+v-va
def cstr(va):
    o=va2off(va)
    if o is None: return None
    e=data.find(b'\0',o); s=data[o:e]
    if 2<=len(s)<120 and all(32<=c<127 for c in s): return s.decode()
start=int(sys.argv[2],16); n=int(sys.argv[3],0); mode=CS_MODE_THUMB if len(sys.argv)>4 and sys.argv[4]=='t' else CS_MODE_ARM
md=Cs(CS_ARCH_ARM,mode); md.detail=False; md.skipdata=True
code=data[va2off(start):va2off(start)+n]
for ins in md.disasm(code,start):
    note=''
    m=re.search(r'\[pc, #(-?0x[0-9a-f]+|-?\d+)\]',ins.op_str)
    if m and ins.mnemonic.startswith('ldr'):
        pcv=(ins.address+8) if mode==CS_MODE_ARM else ((ins.address+4)&~3)
        a=pcv+int(m.group(1),0); v=struct.unpack('<I',data[va2off(a):va2off(a)+4])[0]
        s=cstr((v+GOT)&0xffffffff) or cstr(v)
        note=f'  ; ={v:#x}' + (f' "{s}"' if s else '')
    print(f'{ins.address:#x}: {ins.mnemonic:8} {ins.op_str}{note}')
