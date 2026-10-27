import sys,json,struct,subprocess
from elftools.elf.elffile import ELFFile
data=open('/home/claude/native/libcocos2dcpp.so','rb').read(); elf=ELFFile(open('/home/claude/native/libcocos2dcpp.so','rb'))
segs=[(s['p_vaddr'],s['p_offset'],s['p_filesz']) for s in elf.iter_segments() if s['p_type']=='PT_LOAD']
def off(v):
    for va,po,sz in segs:
        if va<=v<va+sz: return po+v-va
plt=json.load(open('/tmp/claude-0/plt.json'))
out=[]
for a in sys.argv[1:]:
    v=int(a,16); lit=struct.unpack_from('<I',data,off(v+8))[0]; t=(v+12+lit)&0xffffffff
    out.append(plt.get(hex(t),hex(t)))
print('\n'.join(f'{a} {n}' for a,n in zip(sys.argv[1:],subprocess.run(['c++filt'],input='\n'.join(out),capture_output=True,text=True).stdout.split('\n'))))
