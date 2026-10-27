import sys,struct
sys.path.insert(0,'/home/claude/re')
from eft import load
d,sets=load('/home/claude/native/effect.ptcl')
pick=[('arLike','heart'),('arQuestion','question'),('arCry','drop_left'),('arJoy','flower'),('arAnger','smoke'),('arOk','ok'),('arSleepness','bubble')]
E={(s['name'],e['name']):e for s in sets for e in s['emitters']}
lo,hi=int(sys.argv[1],16),int(sys.argv[2],16)
print('off   '+' '.join(f'{n[:12]:>13}' for _,n in pick))
for o in range(lo,hi,4):
    row=[]
    for k in pick:
        b=E[k]['body']; i=struct.unpack_from('<i',b,o)[0]; f=struct.unpack_from('<f',b,o)[0]
        row.append(f'{i:>13}' if -100000<i<100000 else f'{f:>13.4g}')
    print(f'{o:04x}  '+' '.join(row))
