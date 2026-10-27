# tools
Requirements: Python 3.10+, `pip install androguard lief pyelftools capstone unicorn`, Java 11+ and apktool 2.10.0 (for smali/res decoding).

Reproduce Session 1 (paths are examples):
```
python3 tools/apk-analysis/apk_catalog.py Miitomo_2.4.0_APKPure.apk > reference-metadata/miitomo-2.4.0.catalog.json
unzip -q Miitomo_2.4.0_APKPure.apk -d ../work/x/apk
java -jar apktool.jar d -f -o ../work/x/apktool Miitomo_2.4.0_APKPure.apk
cd ../work/x/apk/lib/armeabi-v7a
python3 tools/binary-analysis/emu_call.py libsakasho.so 0x3a4cd 2007   # -> https://api.miitomo.com
python3 tools/binary-analysis/emu_call.py libsakasho.so 0x3a9bd 2007   # -> https://support.miitomo.com/
python3 tools/binary-analysis/disfunc.py libsakasho.so Java_jp_dena_sakasho_core_SakashoSystem_getApiBaseURL
python3 tools/binary-analysis/xrefs.py libsakasho.so 0x3a684
```
Addresses are for libsakasho.so SHA256 8e9f69e26e8c9fb754bb26af2b89fc3b6bf681a635336d4333340abba6eec449 (2.4.0) only.
