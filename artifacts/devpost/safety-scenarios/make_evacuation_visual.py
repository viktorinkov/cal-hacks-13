"""Editable product illustration of the verified evacuation model. No app UI."""
import html, json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'diagrams/generator'))
from lib import Scene
OUT = pathlib.Path(__file__).resolve().parent
s = Scene()
s.begin_frame('Fire evacuation', 0, 80, 1600, 820)
parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="920" viewBox="0 0 1600 920">', '<rect width="1600" height="920" fill="#ffffff"/>']
def rect(x,y,w,h,fill,stroke='transparent',r=18):
    s.base('rectangle',x,y,w,h,backgroundColor=fill,strokeColor=stroke,strokeWidth=1,roughness=0,roundness={'type':3})
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}"/>')
def ellipse(x,y,w,h,fill):
    s.base('ellipse',x,y,w,h,backgroundColor=fill,strokeColor='transparent',strokeWidth=0,roughness=0)
    parts.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" fill="{fill}"/>')
def text(x,y,body,size=28,color='#24333d',center=False):
    lines=body.split('\n'); w=max(len(l) for l in lines)*size*.64+4
    s.base('text',x-w/2 if center else x,y,w,len(lines)*size*1.25,text=body,originalText=body,fontSize=size,fontFamily=5,textAlign='center' if center else 'left',verticalAlign='top',containerId=None,autoResize=True,lineHeight=1.25,strokeColor=color,roughness=0)
    for i,line in enumerate(lines):
        parts.append(f'<text x="{x}" y="{y+size+i*size*1.25}" font-family="Excalifont, Arial, sans-serif" font-size="{size}" fill="{color}" text-anchor="{"middle" if center else "start"}">{html.escape(line)}</text>')
def path(points,color='#2e8d71',width=8,arrow=False,dashed=False):
    x,y=points[0]; typ='arrow' if arrow else 'line'
    s.base(typ,x,y,max(p[0] for p in points)-min(p[0] for p in points),max(p[1] for p in points)-min(p[1] for p in points),points=[[px-x,py-y] for px,py in points],strokeColor=color,strokeWidth=width,roughness=0,strokeStyle='dashed' if dashed else 'solid',startArrowhead=None,endArrowhead='triangle' if arrow else None,startBinding=None,endBinding=None,lastCommittedPoint=None,elbowed=False)
    pts=' '.join(f'{a},{b}' for a,b in points)
    parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'+(' stroke-dasharray="14 12"' if dashed else '')+f'{" marker-end=\"url(#head)\"" if arrow else ""}/>')
def person(x,y,color,scale=1,medic=False):
    ellipse(x-12*scale,y,24*scale,24*scale,color)
    rect(x-16*scale,y+30*scale,32*scale,43*scale,color,r=10)
    path([(x-8*scale,y+69*scale),(x-13*scale,y+94*scale)],color,9*scale)
    path([(x+8*scale,y+69*scale),(x+13*scale,y+94*scale)],color,9*scale)
    if medic:
        rect(x-10*scale,y+45*scale,20*scale,6*scale,'#ffffff',r=0)
        rect(x-3*scale,y+38*scale,6*scale,20*scale,'#ffffff',r=0)
def group(x,y,color):
    person(x-31,y+12,color,.8); person(x+31,y+12,color,.8); person(x,y,color,.95)
def exit_sign(x,y,label):
    rect(x,y,130,70,'#16705b',r=10); text(x+65,y+14,'EXIT',28,'#ffffff',True)
    text(x+65,y+78,label,22,'#476458',True)
parts.append('<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#2e8d71"/></marker></defs>')
# The SVG repeats only the native Excalidraw frame caption, outside the frame body.
parts.append('<text x="45" y="53" font-family="Excalifont, Arial, sans-serif" font-size="40" fill="#24333d">Fire evacuation</text>')
rect(45,100,1510,115,'#e2eef8')
person(105,117,'#326285',.75)
text(165,124,'The organizer selects Evacuate',34)
text(165,168,'Groups head to their nearest exit.',25,'#4a6070')
# One simple floor illustration, deliberately not a venue map or app screenshot.
rect(45,250,965,595,'#f4f6f4','#d6ddd6',24)
text(82,273,'Follow the venue paths',30)
# Booth blocks make the route shape immediately legible.
for bx in (230,505,780):
    rect(bx,364,150,93,'#dde5de')
    rect(bx,649,150,90,'#dde5de')
text(305,393,'Booths',23,'#667567',True)
text(580,393,'Booths',23,'#667567',True)
text(855,393,'Booths',23,'#667567',True)
exit_sign(80,500,'West exit')
exit_sign(825,500,'East exit')
# Two groups use different exit choices, with no safest-path claim.
path([(430,615),(430,545),(220,545)],arrow=True)
path([(705,615),(705,545),(812,545)],arrow=True)
group(430,600,'#3b7daa'); group(705,600,'#7870a9')

# The exception is grouped within the same product illustration.
rect(1050,250,505,595,'#fff0ea','#ead6ce',24)
text(1082,273,'Help comes first',30)
person(1193,360,'#318874',1.05,True)
# Seated injured attendee, visibly separate from walking silhouettes.
ellipse(1331,373,28,28,'#bf6655')
rect(1325,410,40,48,'#bf6655',r=10)
path([(1338,453),(1370,453),(1370,483)],'#bf6655',11)
path([(1319,466),(1379,466)],'#caa394',7)
text(1302,509,'Injured attendees\nwait for help.',27,center=True)
path([(1302,606),(1302,668)],arrow=True)
text(1302,702,'After the incident is resolved,\nthey leave too.',25,center=True)
text(45,872,'Behavior illustration • paths and positions are illustrative',20,'#68756f')
s.end_frame()
scene=s.scene(); scene['appState']['viewBackgroundColor']='#ffffff'
(OUT/'evacuation-flow.excalidraw').write_text(json.dumps(scene,indent=1))
parts.append('</svg>'); (OUT/'evacuation-flow.svg').write_text('\n'.join(parts))
