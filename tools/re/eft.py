# EFTB v9 (Miitomo effect.ptcl) walker: sets, emitters (fixed 0xa44-byte struct after 'bin'), textures.
import struct,sys
def load(p):
    d=open(p,'rb').read()
    def hdr(o): return struct.unpack_from('<4sIIIIIIHH',d,o)
    sets=[]; o=0x50
    while True:
        h=hdr(o); name=d[o+0x30:o+0x50].split(b'\0')[0].decode()
        ems=[]
        def walk(c,parent):
            while True:
                eh=hdr(c); body=d[c+eh[5]:c+eh[5]+0xa44]
                ems.append({'off':c,'parent':parent,'name':body[0x10:0x30].split(b'\0')[0].decode('latin1'),'body':body,'hdr':eh})
                if eh[2]!=0xffffffff and eh[7]: walk(c+eh[2],len(ems)-1)
                if eh[3]==0xffffffff: break
                c+=eh[3]
        walk(o+h[2],None); sets.append({'name':name,'emitters':ems})
        if h[3]==0xffffffff: break
        o+=h[3]
    return d,sets
if __name__=='__main__':
    d,sets=load(sys.argv[1])
    for s in sets:
        print(s['name'], [(e['name'], struct.unpack_from('<i',e['body'],0x9c4)[0], struct.unpack_from('<i',e['body'],0x9d8)[0], len(e['body'])) for e in s['emitters']])
