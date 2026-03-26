import { useState, useCallback, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend } from "recharts";

const PALETTE = ["#e63946","#118ab2","#06d6a0","#ffd166","#8338ec","#ff6b6b","#4ecdc4","#f77f00"];
const BG="#0a0a0f",CARD="#12121a",BORDER="#1e1e2e",TEXT="#e8e8e8",MUTED="#6b7280",ACCENT="#e63946";
const fmt=n=>{if(n>=1e8)return(n/1e8).toFixed(0)+"억";if(n>=1e4)return Math.round(n/1e4)+"만";return n.toLocaleString()};

function parseKobis(htmlText, fileName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const tables = doc.querySelectorAll("table");
  if (tables.length < 2) throw new Error("KOBIS 형식이 아닙니다");

  // Extract title
  const titleCell = tables[0]?.querySelector(".tbl_tit_sub");
  let title = fileName.replace(/\.xls[x]?$/i,"").replace(/theroundup/i,"영화");
  if (titleCell) {
    const m = titleCell.textContent.match(/[''「](.+?)[''」]/);
    if (m) title = m[1];
  }

  // Parse data table
  const rows = tables[1].querySelectorAll("tbody tr, tr");
  const data = [];
  let headerFound = false;

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 10) continue;
    const dateStr = cells[0]?.textContent?.trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    const pctParse = s => parseFloat((s||"0").replace(/%/g,"")) || 0;
    data.push({
      date: dateStr,
      screens: parseInt(cells[1]?.textContent?.replace(/,/g,"")) || 0,
      screenShare: pctParse(cells[2]?.textContent),
      showings: parseInt(cells[3]?.textContent?.replace(/,/g,"")) || 0,
      seats: parseInt(cells[5]?.textContent?.replace(/,/g,"")) || 0,
      seatRate: pctParse(cells[7]?.textContent),
      revenue: parseInt(cells[8]?.textContent?.replace(/,/g,"")) || 0,
      audience: parseInt(cells[10]?.textContent?.replace(/,/g,"")) || 0,
      cumRevenue: parseInt(cells[12]?.textContent?.replace(/,/g,"")) || 0,
      cumAudience: parseInt(cells[13]?.textContent?.replace(/,/g,"")) || 0,
      rank: parseInt(cells[14]?.textContent?.replace(/,/g,"")) || 999,
    });
  }

  if (!data.length) throw new Error("데이터를 파싱할 수 없습니다");

  // Detect wide release: first day screens > 50% of max screens
  const maxSc = Math.max(...data.map(d => d.screens));
  const threshold = maxSc * 0.15;
  const wideIdx = data.findIndex(d => d.screens >= threshold);
  const wideDate = wideIdx >= 0 ? data[wideIdx].date : data[0].date;
  const wd = new Date(wideDate);

  // Compute day/week from wide release
  data.forEach(d => {
    const dt = new Date(d.date);
    const diff = Math.floor((dt - wd) / 86400000);
    d.day = diff + 1;
    d.week = diff < 0 ? 0 : Math.floor(diff / 7) + 1;
  });

  const main = data.filter(d => d.day >= 1);
  const weekMap = {};
  main.forEach(d => {
    if (!weekMap[d.week]) weekMap[d.week] = { audience:0, revenue:0, screens:[], seatRates:[], ranks:[], days:0 };
    const w = weekMap[d.week];
    w.audience += d.audience;
    w.revenue += d.revenue;
    w.screens.push(d.screens);
    w.seatRates.push(d.seatRate);
    w.ranks.push(d.rank);
    w.days++;
  });

  const weekly = Object.entries(weekMap)
    .map(([w, v]) => ({
      w: +w,
      au: v.audience,
      rv: v.revenue,
      sc: Math.round(v.screens.reduce((a,b)=>a+b,0)/v.screens.length),
      maxSc: Math.max(...v.screens),
      sr: +(v.seatRates.reduce((a,b)=>a+b,0)/v.seatRates.length).toFixed(1),
      rk: +(v.ranks.reduce((a,b)=>a+b,0)/v.ranks.length).toFixed(1),
    }))
    .filter(w => w.w >= 1 && w.w <= 12)
    .sort((a,b) => a.w - b.w);

  const totalAud = data.length ? data[data.length-1].cumAudience : 0;
  const totalRev = data.length ? data[data.length-1].cumRevenue : 0;
  const mainAud = main.reduce((a,d)=>a+d.audience, 0);
  const peakDay = main.reduce((best,d) => d.audience > best.audience ? d : best, main[0] || {audience:0});
  const w1 = weekly.find(w=>w.w===1);
  const w2 = weekly.find(w=>w.w===2);
  const w1Aud = w1 ? w1.au : 0;
  const w2Aud = w2 ? w2.au : 0;
  const longrun = weekly.filter(w=>w.w>=3).reduce((a,w)=>a+w.au,0);

  return {
    title,
    wideDate,
    totalAud,
    totalRev,
    mainAud,
    peakAud: peakDay.audience || 0,
    peakDate: peakDay.date ? peakDay.date.slice(5) : "",
    peakSc: main.length ? Math.max(...main.map(d=>d.screens)) : 0,
    w1Aud,
    w1Ratio: mainAud ? +(w1Aud/mainAud*100).toFixed(1) : 0,
    dropRate: w1Aud ? +((1-w2Aud/w1Aud)*100).toFixed(1) : 0,
    longrun: mainAud ? +(longrun/mainAud*100).toFixed(1) : 0,
    avgTicket: totalAud ? Math.round(totalRev/totalAud) : 0,
    weekly,
    daily: main.filter(d=>d.day>=1 && d.day<=56),
  };
}

const CTooltip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:"#1a1a2e",border:"1px solid #2a2a3e",borderRadius:8,padding:"10px 14px",fontSize:12,zIndex:100}}>
      <div style={{color:"#ffd166",fontWeight:700,marginBottom:6}}>{label}</div>
      {payload.map((p,i)=>(<div key={i} style={{color:p.color,marginTop:2}}>{p.name}: <b>{typeof p.value==='number'?p.value.toLocaleString():p.value}</b></div>))}
    </div>
  );
};

export default function App() {
  const [movies, setMovies] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const processFiles = useCallback(async (files) => {
    setLoading(true);
    setError("");
    const newMovies = [...movies];
    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = parseKobis(text, file.name);
        // Check duplicate
        if (newMovies.some(m => m.title === parsed.title)) {
          setError(prev => prev + (prev?"\n":"") + `'${parsed.title}'는 이미 추가되어 있습니다.`);
          continue;
        }
        if (newMovies.length >= 8) {
          setError("최대 8편까지 비교할 수 있습니다.");
          break;
        }
        newMovies.push(parsed);
      } catch (e) {
        setError(prev => prev + (prev?"\n":"") + `${file.name}: ${e.message}`);
      }
    }
    setMovies(newMovies);
    setLoading(false);
    if (newMovies.length > 0) setTab("overview");
  }, [movies]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files].filter(f => /\.xls/i.test(f.name));
    if (files.length) processFiles(files);
  }, [processFiles]);

  const removeMovie = (idx) => setMovies(prev => prev.filter((_,i)=>i!==idx));

  // Build comparison data
  const maxWeek = movies.length ? Math.min(Math.max(...movies.map(m=>m.weekly.length ? m.weekly[m.weekly.length-1].w : 0)), 12) : 8;
  const weeks = Array.from({length:maxWeek},(_,i)=>i+1);

  const weeklyComp = weeks.map(w => {
    const row = { week: w+"주차" };
    movies.forEach((m,i) => {
      const wk = m.weekly.find(x=>x.w===w);
      row["au"+i] = wk ? +(wk.au/10000).toFixed(1) : 0;
    });
    return row;
  });

  const cumComp = weeks.map(w => {
    const row = { week: w+"주차" };
    movies.forEach((m,i) => {
      let cum = 0;
      m.weekly.filter(x=>x.w<=w).forEach(x=>cum+=x.au);
      row["cu"+i] = +(cum/10000).toFixed(0);
    });
    return row;
  });

  const seatComp = weeks.map(w => {
    const row = { week: w+"주차" };
    movies.forEach((m,i) => {
      const wk = m.weekly.find(x=>x.w===w);
      row["sr"+i] = wk ? wk.sr : 0;
    });
    return row;
  });

  const screenComp = weeks.map(w => {
    const row = { week: w+"주차" };
    movies.forEach((m,i) => {
      const wk = m.weekly.find(x=>x.w===w);
      row["sc"+i] = wk ? wk.sc : 0;
    });
    return row;
  });

  const hasMovies = movies.length > 0;

  return (
    <div style={{background:BG,color:TEXT,minHeight:"100vh",fontFamily:"'Pretendard','Noto Sans KR',sans-serif",padding:20}}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet"/>

      {/* Header */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:24,fontWeight:900,background:"linear-gradient(135deg,#e63946,#ffd166)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:4}}>
          KOBIS 영화 흥행 분석기
        </div>
        <div style={{fontSize:11,color:MUTED}}>영화진흥위원회 통합전산망(KOBIS)에서 다운로드한 .xls 파일을 업로드하면 자동으로 분석합니다</div>
      </div>

      {/* Upload Area */}
      <div
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={handleDrop}
        onClick={()=>fileRef.current?.click()}
        style={{
          border:`2px dashed ${dragOver?"#e63946":BORDER}`,
          borderRadius:12,
          padding:movies.length?"16px 20px":"40px 20px",
          textAlign:"center",
          cursor:"pointer",
          background:dragOver?"#1a0a0f":CARD,
          transition:"all 0.3s",
          marginBottom:16,
        }}
      >
        <input ref={fileRef} type="file" accept=".xls,.xlsx" multiple style={{display:"none"}}
          onChange={e=>{if(e.target.files.length) processFiles([...e.target.files]); e.target.value="";}} />

        {!hasMovies ? (
          <>
            <div style={{fontSize:36,marginBottom:8}}>📂</div>
            <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>KOBIS .xls 파일을 여기에 드래그하거나 클릭하여 업로드</div>
            <div style={{fontSize:11,color:MUTED}}>여러 파일을 한 번에 올려서 비교 분석할 수 있습니다 (최대 8편)</div>
            <div style={{fontSize:11,color:MUTED,marginTop:8}}>KOBIS → 통합전산망 → 영화정보 → 일자별 통계정보 → 엑셀 다운로드</div>
          </>
        ) : (
          <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
            <span style={{fontSize:13}}>📂</span>
            <span style={{fontSize:12,color:MUTED}}>클릭하여 영화 추가</span>
          </div>
        )}
      </div>

      {loading && <div style={{textAlign:"center",padding:20,color:ACCENT,fontWeight:700}}>분석 중...</div>}
      {error && <div style={{background:"#1a0a0f",border:"1px solid #e63946",borderRadius:8,padding:12,marginBottom:12,fontSize:12,color:"#ff6b6b"}}>{error}</div>}

      {/* Movie Tags */}
      {hasMovies && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
          {movies.map((m,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:CARD,border:`1px solid ${BORDER}`,borderRadius:8,padding:"6px 12px"}}>
              <div style={{width:10,height:10,borderRadius:3,background:PALETTE[i%8]}}/>
              <span style={{fontSize:12,fontWeight:700,color:PALETTE[i%8]}}>{m.title}</span>
              <span style={{fontSize:10,color:MUTED}}>{fmt(m.totalAud)}</span>
              <button onClick={(e)=>{e.stopPropagation();removeMovie(i)}} style={{background:"none",border:"none",color:MUTED,cursor:"pointer",fontSize:14,lineHeight:1,padding:0}}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Dashboard */}
      {hasMovies && (
        <>
          {/* KPI Grid */}
          <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(movies.length,4)},1fr)`,gap:10,marginBottom:16}}>
            {movies.map((m,i)=>(
              <div key={i} style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:12,padding:16,borderTop:`3px solid ${PALETTE[i%8]}`}}>
                <div style={{fontSize:12,fontWeight:800,color:PALETTE[i%8],marginBottom:10}}>{m.title}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {[
                    ["총 관객",fmt(m.totalAud)],
                    ["총 매출",fmt(m.totalRev)],
                    ["1주차 집중도",m.w1Ratio+"%"],
                    ["2주차 드롭률",m.dropRate+"%"],
                    ["롱런 지수",m.longrun+"%"],
                    ["피크일",fmt(m.peakAud)],
                  ].map(([l,v],j)=>(
                    <div key={j}>
                      <div style={{fontSize:9,color:MUTED,letterSpacing:0.5}}>{l}</div>
                      <div style={{fontSize:14,fontWeight:800}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
            {[["overview","주차별 관객"],["cumulative","누적 추이"],["efficiency","스크린 효율"],["table","비교 테이블"]].map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)} style={{
                padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
                background:tab===k?ACCENT:CARD,color:tab===k?"#fff":MUTED
              }}>{l}</button>
            ))}
          </div>

          {tab==="overview" && (
            <div>
              <div style={{background:CARD,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${BORDER}`}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>주차별 관객수 비교 (만명)</div>
                <div style={{fontSize:11,color:MUTED,marginBottom:14}}>개봉 후 주차별 관객 동원 추이 비교</div>
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={weeklyComp} margin={{top:5,right:10,left:0,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER}/>
                    <XAxis dataKey="week" tick={{fill:MUTED,fontSize:11}}/>
                    <YAxis tick={{fill:MUTED,fontSize:10}} tickFormatter={v=>v+"만"}/>
                    <Tooltip content={<CTooltip/>}/>
                    {movies.map((m,i)=>(<Line key={i} type="monotone" dataKey={"au"+i} name={m.title} stroke={PALETTE[i%8]} strokeWidth={2.5} dot={{r:4,fill:PALETTE[i%8]}}/>))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={{display:"grid",gridTemplateColumns:movies.length>2?"1fr 1fr":"1fr",gap:12}}>
                {movies.map((m,i)=>(
                  <div key={i} style={{background:CARD,borderRadius:12,padding:16,border:`1px solid ${BORDER}`}}>
                    <div style={{fontSize:13,fontWeight:700,color:PALETTE[i%8],marginBottom:8}}>{m.title} — 주차별 관객</div>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={m.weekly.slice(0,8).map(w=>({w:w.w+"주",au:+(w.au/10000).toFixed(1)}))} margin={{top:0,right:5,left:-10,bottom:0}}>
                        <XAxis dataKey="w" tick={{fill:MUTED,fontSize:9}}/>
                        <YAxis tick={{fill:MUTED,fontSize:9}} tickFormatter={v=>v+"만"}/>
                        <Tooltip content={<CTooltip/>}/>
                        <Bar dataKey="au" name="관객(만)" fill={PALETTE[i%8]} radius={[4,4,0,0]} opacity={0.8}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab==="cumulative" && (
            <div>
              <div style={{background:CARD,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${BORDER}`}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>누적 관객수 비교 (만명)</div>
                <div style={{fontSize:11,color:MUTED,marginBottom:14}}>기울기가 가파를수록 빠른 흥행</div>
                <ResponsiveContainer width="100%" height={360}>
                  <ComposedChart data={cumComp} margin={{top:5,right:10,left:0,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER}/>
                    <XAxis dataKey="week" tick={{fill:MUTED,fontSize:11}}/>
                    <YAxis tick={{fill:MUTED,fontSize:10}} tickFormatter={v=>v+"만"}/>
                    <Tooltip content={<CTooltip/>}/>
                    {movies.map((m,i)=>(<Line key={i} type="monotone" dataKey={"cu"+i} name={m.title} stroke={PALETTE[i%8]} strokeWidth={3} dot={{r:5,fill:PALETTE[i%8],stroke:BG,strokeWidth:2}}/>))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                {movies.map((m,i)=>{
                  const w8cum = m.weekly.filter(w=>w.w<=8).reduce((a,w)=>a+w.au,0);
                  const pct = m.totalAud ? (w8cum/m.totalAud*100).toFixed(1) : 0;
                  return (
                    <div key={i} style={{flex:1,minWidth:160,background:CARD,borderRadius:8,padding:16,borderTop:`3px solid ${PALETTE[i%8]}`,border:`1px solid ${BORDER}`}}>
                      <div style={{fontSize:12,fontWeight:700,color:PALETTE[i%8],marginBottom:6}}>{m.title}</div>
                      <div style={{fontSize:22,fontWeight:900}}>{pct}%</div>
                      <div style={{fontSize:10,color:MUTED,marginTop:2}}>8주차 {Math.round(w8cum/10000)}만 / 총 {Math.round(m.totalAud/10000)}만</div>
                      <div style={{width:"100%",height:6,background:"#1e1e2e",borderRadius:3,marginTop:8}}>
                        <div style={{width:pct+"%",height:"100%",background:PALETTE[i%8],borderRadius:3}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab==="efficiency" && (
            <div>
              <div style={{background:CARD,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${BORDER}`}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>주차별 좌석판매율 비교 (%)</div>
                <div style={{fontSize:11,color:MUTED,marginBottom:14}}>판매율이 높을수록 스크린 배분 효율이 좋음</div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={seatComp} margin={{top:5,right:10,left:0,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER}/>
                    <XAxis dataKey="week" tick={{fill:MUTED,fontSize:11}}/>
                    <YAxis tick={{fill:MUTED,fontSize:10}} tickFormatter={v=>v+"%"}/>
                    <Tooltip content={<CTooltip/>}/>
                    {movies.map((m,i)=>(<Line key={i} type="monotone" dataKey={"sr"+i} name={m.title} stroke={PALETTE[i%8]} strokeWidth={2.5} dot={{r:4,fill:PALETTE[i%8]}}/>))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={{background:CARD,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${BORDER}`}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>주차별 평균 스크린수 비교</div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={screenComp} margin={{top:5,right:10,left:0,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER}/>
                    <XAxis dataKey="week" tick={{fill:MUTED,fontSize:11}}/>
                    <YAxis tick={{fill:MUTED,fontSize:10}}/>
                    <Tooltip content={<CTooltip/>}/>
                    {movies.map((m,i)=>(<Line key={i} type="monotone" dataKey={"sc"+i} name={m.title} stroke={PALETTE[i%8]} strokeWidth={2.5} dot={{r:4,fill:PALETTE[i%8]}}/>))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                {movies.map((m,i)=>{
                  const w1 = m.weekly.find(w=>w.w===1);
                  const eff = w1 && w1.sc ? Math.round(w1.au/w1.sc) : 0;
                  return (
                    <div key={i} style={{flex:1,minWidth:140,background:CARD,borderRadius:8,padding:16,borderTop:`3px solid ${PALETTE[i%8]}`,border:`1px solid ${BORDER}`}}>
                      <div style={{fontSize:12,fontWeight:700,color:PALETTE[i%8],marginBottom:4}}>{m.title}</div>
                      <div style={{fontSize:26,fontWeight:900}}>{eff.toLocaleString()}</div>
                      <div style={{fontSize:10,color:MUTED}}>명/스크린 (1주차)</div>
                      <div style={{fontSize:10,color:MUTED}}>스크린 {w1?.sc?.toLocaleString()||0}개</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab==="table" && (
            <div style={{background:CARD,borderRadius:12,padding:20,border:`1px solid ${BORDER}`,overflowX:"auto"}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>시리즈 핵심 지표 비교 테이블</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:600}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${BORDER}`}}>
                    {["영화","개봉일","총 관객","총 매출","1주차 집중도","2주차 드롭률","롱런 지수","피크일 관객","최대 스크린","평균 티켓가"].map(h=>(
                      <th key={h} style={{padding:"8px 8px",textAlign:"right",color:MUTED,fontWeight:600,fontSize:10,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {movies.map((m,i)=>(
                    <tr key={i} style={{borderBottom:`1px solid ${BORDER}`}}>
                      <td style={{padding:"8px",fontWeight:700,color:PALETTE[i%8],textAlign:"left",whiteSpace:"nowrap"}}>{m.title}</td>
                      <td style={{padding:"8px",textAlign:"right",fontSize:11}}>{m.wideDate}</td>
                      <td style={{padding:"8px",textAlign:"right",fontWeight:700}}>{fmt(m.totalAud)}</td>
                      <td style={{padding:"8px",textAlign:"right"}}>{fmt(m.totalRev)}</td>
                      <td style={{padding:"8px",textAlign:"right",color:m.w1Ratio>45?ACCENT:m.w1Ratio>35?"#ffd166":"#06d6a0"}}>{m.w1Ratio}%</td>
                      <td style={{padding:"8px",textAlign:"right",color:m.dropRate>50?ACCENT:m.dropRate>30?"#ffd166":"#06d6a0"}}>{m.dropRate}%</td>
                      <td style={{padding:"8px",textAlign:"right",color:m.longrun>40?"#06d6a0":m.longrun>30?"#ffd166":ACCENT}}>{m.longrun}%</td>
                      <td style={{padding:"8px",textAlign:"right"}}>{fmt(m.peakAud)}</td>
                      <td style={{padding:"8px",textAlign:"right"}}>{m.peakSc.toLocaleString()}</td>
                      <td style={{padding:"8px",textAlign:"right"}}>{m.avgTicket.toLocaleString()}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Weekly detail per movie */}
              {movies.map((m,i)=>(
                <div key={i} style={{marginTop:20}}>
                  <div style={{fontSize:13,fontWeight:700,color:PALETTE[i%8],marginBottom:8}}>{m.title} — 주차별 상세</div>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead>
                      <tr style={{borderBottom:`1px solid ${BORDER}`}}>
                        {["주차","관객수","매출액","평균 스크린","좌석판매율","평균 순위"].map(h=>(
                          <th key={h} style={{padding:"6px 8px",textAlign:"right",color:MUTED,fontSize:10}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {m.weekly.slice(0,8).map((w,j)=>(
                        <tr key={j} style={{borderBottom:`1px solid ${BORDER}`}}>
                          <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{w.w}주차</td>
                          <td style={{padding:"6px 8px",textAlign:"right"}}>{w.au.toLocaleString()}</td>
                          <td style={{padding:"6px 8px",textAlign:"right"}}>{fmt(w.rv)}</td>
                          <td style={{padding:"6px 8px",textAlign:"right"}}>{w.sc.toLocaleString()}</td>
                          <td style={{padding:"6px 8px",textAlign:"right",color:w.sr>30?"#06d6a0":w.sr>15?"#ffd166":ACCENT}}>{w.sr}%</td>
                          <td style={{padding:"6px 8px",textAlign:"right"}}>{w.rk}위</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          <div style={{marginTop:20,fontSize:10,color:MUTED,textAlign:"center"}}>
            출처: 영화진흥위원회 영화관입장권통합전산망(KOBIS) | 포트폴리오용 분석 도구
          </div>
        </>
      )}
    </div>
  );
}
