#!/usr/bin/env python3
"""Reference PowerVR POD parser (Python) used to validate the TypeScript loader.
parse(bytes) -> dict(scene fields, materials, textures, nodes, meshes) with raw blocks decoded."""
import struct
CONTAINERS={1001,2010,2011,2012,2013,2014,2015,6003,6006,6007,6008,6009,6010,6011,6012,6013}
def _blocks(d,o,end):
    out=[]
    while o<end:
        tag,ln=struct.unpack_from('<Ii',d,o); o+=8
        if tag&0x80000000: return out,o
        if tag in CONTAINERS:
            kids,o=_blocks(d,o,end); out.append((tag,kids))
        else:
            out.append((tag,d[o:o+ln])); o+=ln
            et,_=struct.unpack_from('<Ii',d,o); assert et==tag|0x80000000; o+=8
    return out,o
i32=lambda b:struct.unpack('<i',b)[0]
f32s=lambda b:list(struct.unpack(f'<{len(b)//4}f',b))
i32s=lambda b:list(struct.unpack(f'<{len(b)//4}i',b))
s0=lambda b:b.split(b'\0')[0].decode('latin1')
def _data(kids):
    r={}
    for t,v in kids:
        if t==9000:r['type']=i32(v)
        elif t==9001:r['n']=i32(v)
        elif t==9002:r['stride']=i32(v)
        elif t==9003:r['data']=v
    return r
def parse(d):
    top,_=_blocks(d,0,len(d))
    scene=[k for t,k in top if t==1001][0]
    S={'materials':[],'textures':[],'nodes':[],'meshes':[]}
    for t,v in scene:
        if t==2015:
            m={}
            for tt,vv in v:
                if tt==3000:m['name']=s0(vv)
                elif tt==3001:m['texDiffuse']=i32(vv)
                elif tt in(3003,3004,3005):m[{3003:'ambient',3004:'diffuse',3005:'specular'}[tt]]=f32s(vv)
            S['materials'].append(m)
        elif t==2014: S['textures'].append(s0([vv for tt,vv in v if tt==4000][0]))
        elif t==2013:
            n={'mat':-1}
            for tt,vv in v:
                if tt==5000:n['idx']=i32(vv)
                elif tt==5001:n['name']=s0(vv)
                elif tt==5002:n['mat']=i32(vv)
                elif tt==5003:n['parent']=i32(vv)
                elif tt==5012:n['animFlags']=i32(vv)
                elif tt==5007:n['pos']=f32s(vv)
                elif tt==5008:n['rot']=f32s(vv)
                elif tt==5009:n['scale']=f32s(vv)
                elif tt==5011:n['matrix']=f32s(vv)
                elif tt==5017:n['userData']=vv
            S['nodes'].append(n)
        elif t==2012:
            m={}
            for tt,vv in v:
                if tt==6000:m['numVtx']=i32(vv)
                elif tt==6001:m['numFaces']=i32(vv)
                elif tt==6002:m['numUVW']=i32(vv)
                elif tt==6015:m['boneBatches']=i32s(vv)
                elif tt==6016:m['boneBatchBoneCnts']=i32s(vv)
                elif tt==6017:m['boneBatchOffsets']=i32s(vv)
                elif tt==6018:m['boneBatchBoneMax']=i32(vv)
                elif tt==6019:m['boneBatchCnt']=i32(vv)
                elif tt==6014:m['interleaved']=vv
                elif tt==6020:m['unpack']=f32s(vv)
                elif tt in(6003,6006,6007,6008,6009,6010,6011,6012,6013):
                    m[{6003:'faces',6006:'vtx',6007:'nor',6008:'tan',6009:'bin',6010:'uvw',6011:'col',6012:'boneIdx',6013:'boneWeight'}[tt]]=_data(vv)
            S['meshes'].append(m)
        elif t in(2004,2005,2006,2007,2008,2009,2016,2017): S[{2004:'numMesh',2005:'numNode',2006:'numMeshNode',2007:'numTexture',2008:'numMaterial',2009:'numFrame',2016:'flags',2017:'fps'}[t]]=i32(v)
        elif t==2019: S['units']=f32s(v)[0]
    return S
