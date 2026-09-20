from pathlib import Path
import urllib.request, json, re
token=Path.home().joinpath('.cache/huggingface/token').read_text().strip()
req=urllib.request.Request('https://huggingface.co/api/spaces?author=Reubencf',headers={'Authorization':'Bearer '+token})
print('Spaces:',[(s['id'],s.get('sdk')) for s in json.load(urllib.request.urlopen(req))])
for query in ['supreme@400','supreme@1','supreme@401','bespoke-stencil@700']:
    url='https://api.fontshare.com/v2/css?f[]='+query+'&display=swap'
    css=urllib.request.urlopen(url).read().decode()
    Path('work/font-'+query.replace('@','-')+'.css').write_text(css)
    print(query,re.findall(r'font-family: ([^;]+)',css),re.findall(r'font-weight: ([^;]+)',css))
