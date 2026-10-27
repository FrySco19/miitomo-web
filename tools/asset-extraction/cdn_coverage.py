#!/usr/bin/env python3
"""Compare CDN manifest.json against Wayback CDX captures. Usage: cdn_coverage.py manifest.json cdx.txt [out.tsv]"""
import json, sys, re, collections
m=json.load(open(sys.argv[1])); assets=m['assets']
cap={}
for l in open(sys.argv[2]):
    f=l.split()
    if len(f)>=5 and f[4]=='200' and '/native/20180125111639/android/v2/' in f[2]:
        cap[f[2].split('/android/v2/')[1].split('?')[0]]=f[1]
def cat(name):
    n=re.sub(r'\.zip$','',name)
    if n.startswith('asset_'): n=n[6:]; n=re.sub(r'_[^_]*$','',n) if '_output_' in n else n; return re.sub(r'\d+$','',n)
    if re.match(r'^\d{8}',n): return '(dated:'+re.sub(r'^\d{8}[a-z0-9]+','',n)+')'
    return re.sub(r'\d+','#',n)
tot=collections.Counter(); have=collections.Counter(); rows=[]
for k,v in assets.items():
    fn=v['path'].split('/')[-1]; c=cat(fn); tot[c]+=1; ok=fn in cap; have[c]+=ok
    rows.append((k,v['path'],v.get('md5',''),c,'1' if ok else '0',cap.get(fn,'')))
print(f"manifest version {m['version']} assets {len(assets)} captured {sum(have.values())} ({100*sum(have.values())/len(assets):.1f}%)")
for c,n in tot.most_common(): print(f"{c:60s} {have[c]:5d}/{n:5d}  {100*have[c]/n:5.1f}%")
if len(sys.argv)>3:
    with open(sys.argv[3],'w') as o:
        o.write('id\tpath\tmd5\tcategory\tcaptured\twayback_ts\n')
        for r in rows: o.write('\t'.join(r)+'\n')
