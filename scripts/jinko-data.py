"""
人口の記事（/jinko/）のグラフ用データ content/data/jinko.json を作る。

  1. 枚方市「人口の推移・動態・外国人人口」の Excel を落とす
     https://www.city.hirakata.osaka.jp/0000018550.html
  2. python3 scripts/jinko-data.py <Excel> content/data/jinko.json

国勢調査と将来推計は Excel に無いので、下の表に手で書いている（出典は _source）。
"""
import openpyxl, json, re, sys
wb=openpyxl.load_workbook(sys.argv[1],data_only=True)
def year(label):
    m=re.match(r'(昭和|平成|令和)(元|\d+)年',str(label).strip())
    if not m: return None
    n=1 if m.group(2)=='元' else int(m.group(2))
    return {'昭和':1925,'平成':1988,'令和':2018}[m.group(1)]+n
fx={}
for r in wb['外国人人口（～R5年）'].iter_rows(min_row=5,values_only=True):
    v=[c for c in r if c is not None]
    if len(v)>2 and year(v[0]) and isinstance(v[2],int): fx.setdefault(year(v[0]),v[2])
annual=[]
for r in wb['人口の推移'].iter_rows(min_row=7,max_row=85,values_only=True):
    v=[c for c in r if c is not None]
    if len(v)<3 or not isinstance(v[1],int): continue
    y=year(v[0]); pop=v[2]
    row={'year':y,'households':v[1],'registered':pop}
    if y<2012:
        row['japaneseOnly']=True
        if y in fx: row['foreign']=fx[y]; row['total']=pop+fx[y]
        else: row['total']=pop
    else: row['total']=pop
    annual.append(row)
vital=[]
for r in wb['人口の動態'].iter_rows(min_row=11,values_only=True):
    v=[c for c in r if c is not None]
    if len(v)<7 or not isinstance(v[0],str) or '月' in v[0] or not isinstance(v[1],int): continue
    y=year(v[0])
    if not y: continue
    # 2012年までは 出生・死亡・自然増・転入・転出・社会増、2013年からは 転入・その他・転出・その他・社会増
    if y<=2012: b,d,i,o,soc=v[1],v[2],v[4],v[5],v[6]
    else: b,d,i,o,soc=v[1],v[2],v[4],v[6],v[8]
    vital.append({'year':y,'births':b,'deaths':d,'natural':b-d,'movedIn':i,'movedOut':o,'social':soc})
# 外国人。2023年までは1つ目のシート（1つ目の表に 朝鮮・韓国・中国、2つ目の表にベトナム）、2024年からは2つ目のシート
foreign={}
seen=set()
for r in wb['外国人人口（～R5年）'].iter_rows(values_only=True):
    v=[c for c in r if c is not None]
    if len(v)<9 or not year(v[0]): continue
    y=year(v[0])
    if y not in seen:
        seen.add(y); foreign[y]={'year':y,'total':v[2],'korea':v[5],'china':v[6]}
    else:
        foreign[y]['vietnam']=v[8]
cur=None
rows=[[c for c in r if c is not None] for r in wb['外国人人口（R5年～）'].iter_rows(values_only=True)]
for k,v in enumerate(rows):
    if v and isinstance(v[0],str) and year(v[0].strip()):
        cur={'_y':year(v[0].strip())}; names=v[1:]
        vals=rows[k+1]; cur.update(dict(zip(names,vals)))
        foreign.setdefault(cur['_y'],{'year':cur['_y']}).update(_raw=cur)
    elif cur and v and all(isinstance(c,str) for c in v) and k+1<len(rows) and rows[k+1] and all(isinstance(c,int) for c in rows[k+1]):
        cur.update(dict(zip(v,rows[k+1])))
for y,f in foreign.items():
    raw=f.pop('_raw',None)
    if raw and y>=2024:
        f.update({'total':raw['総数'],'china':raw['中国'],'vietnam':raw['ベトナム'],'korea':raw['韓国']+raw.get('朝鮮',0)})
foreign=[foreign[y] for y in sorted(foreign)]

census=[(1950,52817),(1955,59327),(1960,80312),(1965,127520),(1970,217369),(1975,297618),(1980,353358),(1985,382257),(1990,390788),(1995,400144),(2000,402563),(2005,404044),(2010,407978),(2015,404152),(2020,397289),(2025,388860)]
proj=[(2023,47378,234012,114070),(2028,40933,226459,120141),(2033,35373,213630,126591),(2038,31559,192982,136214),(2043,30537,172210,140185),(2048,28896,157430,138173),(2053,26476,145698,134235)]
out={'_source':{
  'annual':'枚方市「人口の推移・動態・外国人人口」R8.11.xlsx「人口の推移」（住民基本台帳、各年末。2016年分からは翌年1月1日現在）。2011年以前は日本人だけなので、1999〜2011年は同じ表の「外国人人口」を足して total にした。1998年以前の total は日本人だけ',
  'vital':'同上「人口の動態」（各年1〜12月）。2013年以降の転入・転出は「その他」（職権記載など）を含まない',
  'census':'国勢調査（各年10月1日）。1950〜2020年は枚方市「令和2年国勢調査 人口等基本集計結果の概要」表1-1、2025年は大阪府「令和7年国勢調査 大阪府の人口及び世帯数（確定値）」付表',
  'foreign':'同上「外国人人口」（各年12月末）。2011年までは外国人登録、2012年からは住民基本台帳。korea は「朝鮮・韓国」（2024年からは「韓国」と「朝鮮」の和）',
  'projection':'枚方市「枚方市将来人口推計調査報告書」令和5年11月、p.12 ケース4（出生低位・社会移動を見込む）。年齢3区分の人口の和'},
 'annual':annual,'vital':vital,'foreign':foreign,
 'census':[{'year':y,'population':p} for y,p in census],
 'projection':[{'year':y,'population':a+b+c,'under15':a,'age15to64':b,'over65':c} for y,a,b,c in proj]}
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
print(foreign[0],foreign[-3:]); print(len(annual),annual[0],[a for a in annual if a['year'] in (1998,1999,2009,2011,2012,2025)]); print(len(vital),vital[0],vital[14],vital[-1]); print(out['projection'])
