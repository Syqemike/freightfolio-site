from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import json,re,subprocess
root=Path(__file__).resolve().parents[1]
class Page(HTMLParser):
 def __init__(self,text):
  super().__init__();self.ids=[];self.links=[];self.h1=0;self.title=0;self.canonical=[];self.meta={};self.feed(text)
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if 'id' in a:self.ids.append(a['id'])
  if tag=='h1':self.h1+=1
  if tag=='title':self.title+=1
  if tag in ['a','link','script','img','iframe']:
   u=a.get('href') or a.get('src')
   if u:self.links.append(u)
  if tag=='link' and a.get('rel')=='canonical':self.canonical.append(a.get('href'))
  if tag=='meta':self.meta[a.get('name') or a.get('property')]=a.get('content')
files=[p for p in root.glob('*.html') if not p.name.startswith('google')]+list((root/'blog').glob('*.html'))
errors=[];warnings=[]
for p in files:
 text=p.read_text();d=Page(text);relative=str(p.relative_to(root))
 for check,ok in [('one h1',d.h1==1),('one title',d.title==1),('unique IDs',len(d.ids)==len(set(d.ids))),('canonical',len(d.canonical)==1 or p.name in ['404.html','thank-you.html']),('description',bool(d.meta.get('description'))),('main landmark',bool(re.search(r'<main\b',text)))]:
  if not ok:errors.append(f'{relative}: {check}')
 for u in d.links:
  parts=urlsplit(u)
  if parts.scheme or parts.netloc:continue
  if not parts.path:
   if parts.fragment and unquote(parts.fragment) not in d.ids:errors.append(f'{relative}: missing fragment {u}')
   continue
  target=(root/parts.path.lstrip('/')) if parts.path.startswith('/') else p.parent/parts.path
  if not target.exists():
   # Some pre-existing assets are in the complete upstream tree but not local snapshot.
   if parts.path.endswith(('.ico','.png','.jpg')):warnings.append(f'{relative}: asset not in partial local snapshot: {u}')
   else:errors.append(f'{relative}: missing target {u}')
 for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>',text,re.S):
  try:json.loads(block)
  except Exception:errors.append(f'{relative}: malformed JSON-LD')
for name in ['index.html','pricing.html']:
 text=(root/name).read_text()
 for price,pages,plan in [('149','3','starter'),('199','7','professional'),('299','12','business-growth')]:
  for required in [f'${price}',f'Up to {pages} pages',f'plan={plan}']:
   if required not in text:errors.append(f'{name}: missing {required}')
  if text.count('class="price-card')!=3:errors.append(f'{name}: expected 3 plans')
 for forbidden in ['<canvas','data-tilt','<h1>The ']:
  if forbidden in text:errors.append(f'{name}: obsolete {forbidden}')
for js in (root/'js').glob('*.js'):
 p=subprocess.run(['node','--check',str(js)],capture_output=True,text=True)
 if p.returncode:errors.append(f'JS parse failed: {js.name}')
print(f'Public HTML pages checked: {len(files)}')
print(f'Source checks: {"PASS" if not errors else "FAIL"}')
print('\n'.join(errors))
print(f'Partial snapshot asset warnings: {len(warnings)} (existing favicon assets; upstream preserved)')
print('No browser, touch, visual, live HTTP or delivery verification is implied.')
raise SystemExit(bool(errors))
