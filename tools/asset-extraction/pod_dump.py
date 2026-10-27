#!/usr/bin/env python3
"""Dump the block tree of a PowerVR POD file (format per public PowerVR SDK, PVRTModelPOD).
Usage: pod_dump.py file.pod [--data]"""
import struct, sys
NAMES={1000:'Version',1001:'Scene',1002:'ExpOpt',1003:'History',
2000:'ColourBackground',2001:'ColourAmbient',2002:'NumCamera',2003:'NumLight',2004:'NumMesh',2005:'NumNode',2006:'NumMeshNode',
2007:'NumTexture',2008:'NumMaterial',2009:'NumFrame',2010:'Camera',2011:'Light',2012:'Mesh',2013:'Node',2014:'Texture',2015:'Material',
2016:'Flags',2017:'FPS',2018:'UserData',2019:'Units',
3000:'MatName',3001:'MatIdxTexDiffuse',3002:'MatOpacity',3003:'MatAmbient',3004:'MatDiffuse',3005:'MatSpecular',3006:'MatShininess',
3007:'MatEffectFile',3008:'MatEffectName',3009:'MatIdxTexAmbient',3010:'MatIdxTexSpecularColour',3011:'MatIdxTexSpecularLevel',
3012:'MatIdxTexBump',3013:'MatIdxTexEmissive',3014:'MatIdxTexGlossiness',3015:'MatIdxTexOpacity',3016:'MatIdxTexReflection',
3017:'MatIdxTexRefraction',3018:'MatBlendSrcRGB',3019:'MatBlendSrcA',3020:'MatBlendDstRGB',3021:'MatBlendDstA',3022:'MatBlendOpRGB',
3023:'MatBlendOpA',3024:'MatBlendColour',3025:'MatBlendFactor',3026:'MatFlags',3027:'MatUserData',
4000:'TexName',
5000:'NodeIdx',5001:'NodeName',5002:'NodeIdxMat',5003:'NodeIdxParent',5004:'NodePos',5005:'NodeRot',5006:'NodeScale',5007:'NodeAnimPos',
5008:'NodeAnimRot',5009:'NodeAnimScale',5010:'NodeMatrix',5011:'NodeAnimMatrix',5012:'NodeAnimFlags',5013:'NodeAnimPosIdx',
5014:'NodeAnimRotIdx',5015:'NodeAnimScaleIdx',5016:'NodeAnimMatrixIdx',5017:'NodeUserData',
6000:'MeshNumVtx',6001:'MeshNumFaces',6002:'MeshNumUVW',6003:'MeshFaces',6004:'MeshStripLength',6005:'MeshNumStrips',6006:'MeshVtx',
6007:'MeshNor',6008:'MeshTan',6009:'MeshBin',6010:'MeshUVW',6011:'MeshVtxCol',6012:'MeshBoneIdx',6013:'MeshBoneWeight',
6014:'MeshInterleaved',6015:'MeshBoneBatches',6016:'MeshBoneBatchBoneCnts',6017:'MeshBoneBatchOffsets',6018:'MeshBoneBatchBoneMax',
6019:'MeshBoneBatchCnt',6020:'MeshUnpackMatrix',
7000:'LightIdxTgt',7001:'LightColour',7002:'LightType',8000:'CamIdxTgt',8001:'CamFOV',8002:'CamFar',8003:'CamNear',8004:'CamAnimFOV',
9000:'DataType',9001:'NumComponents',9002:'Stride',9003:'Data'}
d=open(sys.argv[1],'rb').read(); showdata='--data' in sys.argv
def walk(o,end,depth):
    while o<end:
        tag,ln=struct.unpack_from('<Ii',d,o); o+=8
        if tag & 0x80000000:
            return o
        n=NAMES.get(tag,str(tag))
        container = tag in (1001,2010,2011,2012,2013,2014,2015,6003,6006,6007,6008,6009,6010,6011,6012,6013)
        if container:
            print('  '*depth+f'<{n}> len={ln} @{o-8:#x}')
            o2=walk(o,end,depth+1)
            o=o2
        else:
            body=d[o:o+ln]
            if ln==4: v=struct.unpack('<i',body)[0]; f=struct.unpack('<f',body)[0]; s=f'{v} ({f:.4g})'
            elif n.endswith('Name') or tag in (1000,1003,3007,3008,4000): s=repr(body.split(b'\0')[0].decode('latin1'))
            elif ln % 4==0 and ln<=64: s=' '.join(f'{x:.4g}' for x in struct.unpack(f'<{ln//4}f',body))
            else: s=f'<{ln} bytes>'
            if showdata or ln<=64 or n=='Data': print('  '*depth+f'{n} = {s}')
            o+=ln
            et,_=struct.unpack_from('<Ii',d,o)
            assert et==(tag|0x80000000), f'missing end tag for {n} at {o:#x}: {et:#x}'
            o+=8
    return o
walk(0,len(d),0)
