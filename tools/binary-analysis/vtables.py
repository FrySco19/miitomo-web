#!/usr/bin/env python3
"""Locate C++ vtables via RTTI (Itanium ABI) in an ARM ELF32 .so.
typeinfo-name string -> typeinfo object (word[1]=name ptr) -> vtable (word[-1]=typeinfo ptr).
Usage: vtables.py lib.so ClassName [ClassName...]"""
import sys, struct, re
p=sys.argv[1]; d=open(p,'rb').read()
import lief
b=lief.parse(p)
def v2o(va):
    for s in b.segments:
        if s.type==lief.ELF.Segment.TYPE.LOAD and s.virtual_address<=va<s.virtual_address+s.physical_size: return va-s.virtual_address+s.file_offset
def o2v(o):
    for s in b.segments:
        if s.type==lief.ELF.Segment.TYPE.LOAD and s.file_offset<=o<s.file_offset+s.physical_size: return o-s.file_offset+s.virtual_address
def words_equal(val):
    pat=struct.pack('<I',val); return [o2v(m.start()) for m in re.finditer(re.escape(pat),d) if m.start()%4==0]
for cls in sys.argv[2:]:
    mangled=(cls if cls.startswith('N') else f'{len(cls)}{cls}').encode()+b'\0'
    for m in re.finditer(b'\0'+re.escape(mangled),d):
        name_va=o2v(m.start()+1)
        for ti in words_equal(name_va):
            ti_va=ti-4
            for vt in words_equal(ti_va):
                if vt is None: continue
                ents=[]; va=vt+4
                while True:
                    w=struct.unpack_from('<I',d,v2o(va))[0]
                    if w==0 or not (0x280eb0<=(w&~1)<0x1677200): break
                    ents.append(w); va+=4
                    if len(ents)>200: break
                print(f'{cls}: typeinfo {ti_va:#x} vtable@{vt-4:#x} methods={len(ents)}', ' '.join(f'{e:#x}' for e in ents))
