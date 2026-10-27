#!/usr/bin/env python3
"""Phase 0 catalog: hashes, package info, signing, components. Usage: apk_catalog.py <apk>"""
import sys, hashlib, zlib, os, json
from loguru import logger; logger.remove()
from androguard.core.apk import APK
p=sys.argv[1]; data=open(p,'rb').read()
out={'file':os.path.basename(p),'size':len(data),
 'md5':hashlib.md5(data).hexdigest(),'sha1':hashlib.sha1(data).hexdigest(),
 'sha256':hashlib.sha256(data).hexdigest(),'crc32':'%08x'%zlib.crc32(data)}
a=APK(p)
out.update(package=a.get_package(),versionName=a.get_androidversion_name(),versionCode=a.get_androidversion_code(),
 minSdk=a.get_min_sdk_version(),targetSdk=a.get_target_sdk_version(),mainActivity=a.get_main_activity(),
 signing={'v1':a.is_signed_v1(),'v2':a.is_signed_v2(),'v3':a.is_signed_v3()},
 permissions=sorted(a.get_permissions()),activities=a.get_activities(),services=a.get_services(),
 receivers=a.get_receivers(),providers=a.get_providers(),features=sorted(a.get_features()),
 abis=sorted({f.split('/')[1] for f in a.get_files() if f.startswith('lib/')}),
 dex=[f for f in a.get_files() if f.endswith('.dex')])
certs=[]
for c in a.get_certificates():
    certs.append({'subject':c.subject.human_friendly,'issuer':c.issuer.human_friendly,'serial':str(c.serial_number),
     'not_before':str(c['tbs_certificate']['validity']['not_before'].native),'not_after':str(c['tbs_certificate']['validity']['not_after'].native),
     'sha256':hashlib.sha256(c.dump()).hexdigest(),'sha1':hashlib.sha1(c.dump()).hexdigest(),
     'sig':f'{c.signature_algo}/{c.hash_algo}','key':f'{c.public_key.algorithm}-{c.public_key.bit_size}'})
out['certificates']=certs
print(json.dumps(out,indent=1,default=str))
