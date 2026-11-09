from PIL import Image, ImageDraw, ImageFont
import os, math, random
out='assets/tables/arena/helios_runners'; os.makedirs(out,exist_ok=True)
font='C:/Windows/Fonts/arialbd.ttf'
def f(n): return ImageFont.truetype(font,n)
def save(im,n): im.save(os.path.join(out,n+'.png'))
w,h=2048,512
im=Image.new('RGB',(w,h),(24,24,24)); d=ImageDraw.Draw(im)
d.rectangle((0,0,w,55),fill='#ff4c08');d.rectangle((0,56,w,68),fill='#efbe78');d.rectangle((0,69,w,80),fill='#9b210c');d.rectangle((0,466,w,511),fill='#fa4b0b');d.rectangle((0,450,w,463),fill='#f8d7a4')
d.ellipse((710,115,1280,685),fill='#ff5206'); d.polygon([(780,320),(1300,235),(1160,285),(1440,250),(1175,342)], fill='#ffc335')
d.polygon([(1370,118),(1870,118),(1790,447),(1285,447)],fill='#f5d6ab')
d.text((1450,168),'09',font=f(180),fill='#191919',stroke_width=1)
for i in range(3): d.polygon([(1750+i*48,285),(1790+i*48,285),(1735+i*48,380),(1695+i*48,380)],fill='#f3490c')
d.text((165,140),'HELIOS',font=f(105),fill='#f8dcb1'); d.text((165,250),'RUNNERS',font=f(100),fill='#f8dcb1'); d.text((170,370),'ORBITAL  RACING  /  09',font=f(25),fill='#f9c884')
for x in range(50,155,30):
 for y in range(150,240,30):
  if ((x//30)+(y//30))%2: d.polygon([(x,y),(x+25,y),(x+17,y+23),(x-8,y+23)],fill='#f9dcb3')
# Identical margin at either end makes repeat seamless.
save(im,'fascia_basecolor')
im=Image.new('RGB',(2048,512),'#f4d4a4'); d=ImageDraw.Draw(im); d.rectangle((0,0,2048,58),fill='#252524');d.rectangle((0,58,2048,100),fill='#f7d9ad');d.rectangle((0,100,2048,255),fill='#ee440d');d.rectangle((0,255,2048,300),fill='#ff6a11');d.rectangle((0,300,2048,320),fill='#f7d8a8');d.rectangle((0,320,2048,360),fill='#d7340b');d.rectangle((0,360,2048,512),fill='#f4d4a4');save(im,'inner_basecolor')
im=Image.new('RGB',(1024,1024),'#f5d6ad');d=ImageDraw.Draw(im);d.polygon([(0,400),(1024,30),(1024,180),(0,550)],fill='#f04a0c');d.polygon([(0,560),(1024,190),(1024,280),(0,650)],fill='#ff7a10');d.polygon([(0,850),(1024,480),(1024,1024),(0,1024)],fill='#202020');save(im,'stand_basecolor')
# A single, proportionate solar system spans both halves of the cross-brace.
brace=Image.new('RGB',(2048,512),'#f5d6ad');bd=ImageDraw.Draw(brace)
bd.polygon([(0,475),(2048,475),(2048,512),(0,512)],fill='#f04a0c')
bd.polygon([(1710,512),(2048,330),(2048,475),(1980,512)],fill='#ff5b0c')
bd.line((360,260,1678,260),fill='#22211f',width=5)
# Central planet and tilted orbit, with planets on the horizon line.
bd.ellipse((945,180,1105,340),fill='#22211f')
orb=Image.new('RGBA',(310,130),(0,0,0,0));od=ImageDraw.Draw(orb);od.ellipse((4,30,306,100),outline='#22211f',width=7)
orb=orb.rotate(18,resample=Image.Resampling.BICUBIC,expand=True)
brace.paste(orb,(1025-orb.width//2,260-orb.height//2),orb)
for x,r in [(500,8),(550,13),(650,15),(750,11),(825,8),(1190,9),(1270,15),(1370,12),(1470,8),(1520,6)]:
 bd.ellipse((x-r,260-r,x+r,260+r),fill='#22211f')
# Small chequered racing device balances the orbit, as on the reference.
for row in range(2):
 for col in range(5):
  if (row+col)%2==0:
   x=1740+col*37-row*10;y=210+row*37
   bd.polygon([(x,y),(x+32,y),(x+22,y+32),(x-10,y+32)],fill='#22211f')
save(brace,'brace_basecolor')
leg=im.copy(); dl=ImageDraw.Draw(leg)
# Inspection label and race number are printed on the leg faces.
dl.rounded_rectangle((330,105,690,320),20,fill='#f8d8aa',outline='#1d1d1c',width=7)
dl.polygon([(510,125),(485,175),(535,175)],fill='#1d1d1c');dl.text((370,185),'TRANSIT',font=f(46),fill='#1d1d1c');dl.text((365,235),'INSPECTION',font=f(31),fill='#1d1d1c')
dl.text((390,665),'09',font=f(170),fill='#f8d8aa')
for i in range(3):dl.polygon([(400,860+i*38),(620,820+i*38),(615,843+i*38),(395,883+i*38)],fill='#f04a0c')
save(leg,'leg_basecolor')
# Subtle deterministic fine finish; periodic across each edge.
random.seed(9); n=512
noise=[[random.randint(-4,4) for x in range(n)] for y in range(n)]
for kind,rough,metal in [('fascia',105,26),('inner',92,18),('stand',125,12),('leg',125,12),('brace',125,12)]:
 r=Image.new('RGB',(n,n)); m=Image.new('RGB',(n,n),(metal,metal,metal)); normal=Image.new('RGB',(n,n)); rp=r.load();np=normal.load()
 for y in range(n):
  for x in range(n):
   q=noise[y][x]; a=max(0,min(255,rough+q));rp[x,y]=(a,a,a)
   dx=noise[y][(x+1)%n]-noise[y][(x-1)%n];dy=noise[(y+1)%n][x]-noise[(y-1)%n][x];np[x,y]=(128+dx,128+dy,255)
 save(r,kind+'_roughness');save(m,kind+'_metallic');save(normal,kind+'_normal')
from PIL import Image
import os
p='assets/tables/arena/helios_runners'
for k in ('fascia','inner','stand','leg','brace'):
 r=Image.open(os.path.join(p,k+'_roughness.png')).convert('L');m=Image.open(os.path.join(p,k+'_metallic.png')).convert('L');Image.merge('RGB',(Image.new('L',r.size,255),r,m)).save(os.path.join(p,k+'_orm.png'))
