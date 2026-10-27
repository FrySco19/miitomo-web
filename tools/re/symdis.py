# disassemble an exported function by address, annotating bl targets with symbol names
import sys,subprocess,re,bisect
syms=[]
for l in open('/tmp/claude-0/syms.txt'):
    m=re.match(r'([0-9a-f]{8}) \w (.*)',l.strip())
    if m: syms.append((int(m.group(1),16),m.group(2)))
syms.sort(); addrs=[a for a,_ in syms]
def name(a):
    i=bisect.bisect_right(addrs,a)-1
    return f'{syms[i][1]}+{a-syms[i][0]:#x}' if i>=0 and a-syms[i][0]<0x4000 else hex(a)
start=int(sys.argv[2],16); n=int(sys.argv[3],0)
out=subprocess.run([sys.executable,'/home/claude/re/armdis.py',sys.argv[1],hex(start),hex(n)]+(sys.argv[4:5]),capture_output=True,text=True).stdout
for l in out.splitlines():
    m=re.search(r'\bbl\w*\s+#(0x[0-9a-f]+)',l)
    if m: l+='   ; '+name(int(m.group(1),16))
    print(l)
