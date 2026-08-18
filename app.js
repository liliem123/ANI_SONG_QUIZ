let allData=[], data=[], order=[], idx=0, score=0, state=null;
let ytPlayer=null, ytReady=false, apiLoaded=false, pendingVideoId=null;
let candidateIds=[], candidateIndex=0, candidateTried=[];
let selectedMode="all";
let selectedYear=null;

const $=s=>document.querySelector(s);

function norm(s){
  return (s||"").normalize("NFKC").toLowerCase()
    .replace(/[\s·・'"“”‘’!?.,:;()[\]{}\-_/]/g,"");
}
function uniq(xs){return [...new Set(xs.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"ko"));}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function current(){return data[order[idx]];}
function setStatus(text){$("#playerStatus").textContent=text;}
function setDiag(text){$("#diag").textContent=text ? ` · ${text}` : "";}
function setCandidateText(text){$("#candidateText").textContent=text||"";}

function getBlockedMap(){
  try{
    const raw=localStorage.getItem("aniSongBlockedVideosV192");
    const obj=raw?JSON.parse(raw):{};
    return obj&&typeof obj==="object"?obj:{};
  }catch(e){return {};}
}
function saveBlockedMap(obj){
  try{localStorage.setItem("aniSongBlockedVideosV192",JSON.stringify(obj));}catch(e){}
}
async function blockCandidate(videoId,errorCode,reason){
  const q=current();
  if(!videoId)return;
  const blocked=getBlockedMap();
  blocked[videoId]={errorCode,reason,anime:q?.anime||"",song:q?.song||""};
  saveBlockedMap(blocked);
}
function applyLocalBlocked(items){
  const blocked=getBlockedMap();

  return (Array.isArray(items) ? items : []).map(x=>{
    const raw=(Array.isArray(x.videoIds)&&x.videoIds.length)
      ? [...new Set(x.videoIds.filter(Boolean))]
      : (x.videoId ? [x.videoId] : []);

    if(!raw.length){
      return {...x,videoIds:[],videoId:""};
    }

    const unblocked=raw.filter(v=>!blocked[v]);

    // 예전 버전에서 모든 후보가 blocked 처리됐더라도
    // 문제 자체를 삭제하지 않고 원본 후보로 다시 시도한다.
    const ids=unblocked.length ? unblocked : raw;

    return {...x,videoIds:ids,videoId:ids[0]||""};
  }).filter(x=>(x.videoIds&&x.videoIds.length)||x.videoId);
}

function injectYouTubeAPI(){
  if(apiLoaded)return;
  apiLoaded=true;
  window.onYouTubeIframeAPIReady=function(){
    ytPlayer=new YT.Player("player",{
      width:"100%",height:"100%",videoId:"",
      playerVars:{controls:1,rel:0,playsinline:1,fs:1,origin:location.origin},
      events:{
        onReady:()=>{
          ytReady=true;
          ytPlayer.setVolume(Number($("#volume").value)||70);
          setStatus("재생 준비 완료");
          if(pendingVideoId)cueVideo(pendingVideoId,true);
        },
        onStateChange:e=>{
          if(e.data===YT.PlayerState.PLAYING)setStatus("재생 중");
          else if(e.data===YT.PlayerState.PAUSED)setStatus("일시정지");
          else if(e.data===YT.PlayerState.BUFFERING)setStatus("버퍼링 중...");
          else if(e.data===YT.PlayerState.CUED)setStatus("재생 준비 완료");
          else if(e.data===YT.PlayerState.ENDED)setStatus("재생 종료");
        },
        onError:e=>{
          const messages={
            2:"잘못된 YouTube 영상 ID",
            5:"HTML5 플레이어 오류",
            100:"삭제되었거나 비공개 영상",
            101:"외부 사이트 재생이 허용되지 않는 영상",
            150:"외부 사이트 재생이 허용되지 않는 영상",
            153:"Referer/API Client 식별 문제"
          };
          const msg=messages[e.data]||`YouTube 오류 (${e.data})`;
          setStatus(msg);
          if([100,101,150].includes(e.data)){
            setTimeout(()=>failCurrentCandidate(e.data,msg),250);
          }else{
            setDiag(`error=${e.data}`);
          }
        },
        onAutoplayBlocked:()=>{
          setStatus("자동 재생이 차단됨 · 재생 버튼을 한 번 눌러주세요");
        }
      }
    });
  };
  const tag=document.createElement("script");
  tag.src="https://www.youtube.com/iframe_api";
  tag.async=true;
  tag.onerror=()=>setStatus("YouTube API 로드 실패");
  document.head.appendChild(tag);
}

function currentCandidate(){return candidateIds[candidateIndex]||"";}
function setupCandidates(q){
  const raw=(Array.isArray(q.videoIds)&&q.videoIds.length)?q.videoIds:(q.videoId?[q.videoId]:[]);
  candidateIds=[...new Set(raw.filter(Boolean))];
  candidateIndex=0;
  candidateTried=[];
  setCandidateText(`YouTube 후보 ${candidateIds.length}개`);
}
function cueVideo(id,autoPlay=true){
  pendingVideoId=id;
  if(!ytReady||!ytPlayer){setStatus("YouTube 플레이어 준비 중...");return;}
  try{
    ytPlayer.loadVideoById({videoId:id,startSeconds:0});
    ytPlayer.setVolume(Number($("#volume").value)||70);
    if(!autoPlay)ytPlayer.pauseVideo();
    setStatus("재생 요청 중...");
  }catch(e){setStatus("영상 준비 실패");}
}
function cueCurrentCandidate(){
  const vid=currentCandidate();
  if(!vid){
    setStatus("재생 가능한 후보 영상 없음");
    setCandidateText("모든 후보 실패");
    $("#answerbox").hidden=false;
    $("#next").disabled=false;
    return;
  }
  if(!candidateTried.includes(vid))candidateTried.push(vid);
  setCandidateText(`후보 ${candidateIndex+1}/${candidateIds.length}`);
  setDiag(`video=${vid}`);
  cueVideo(vid,true);
}
async function failCurrentCandidate(errorCode,reason){
  const failed=currentCandidate();
  if(failed)await blockCandidate(failed,errorCode,reason);
  if(candidateIndex+1<candidateIds.length){
    candidateIndex++;
    setStatus(`다음 후보로 전환 중... (${candidateIndex+1}/${candidateIds.length})`);
    setTimeout(cueCurrentCandidate,300);
  }else{
    setStatus("이 곡의 YouTube 후보가 모두 재생 불가입니다.");
    setCandidateText("재생 가능한 후보 없음");
    $("#answerbox").hidden=false;
    $("#next").disabled=false;
  }
}

function setRevealedUI(revealed){
  $("#videoCurtain").hidden=!!revealed;
  if(revealed)$("#youtubeVisualShell").classList.add("revealed");
  else $("#youtubeVisualShell").classList.remove("revealed");
}

function setAnswerImage(url){
  const img=$("#answerImage");
  const fb=$("#imageFallback");
  if(url){
    img.hidden=false;
    fb.hidden=true;
    img.src=url;
    img.onerror=()=>{
      img.hidden=true;
      fb.hidden=false;
    };
  }else{
    img.hidden=true;
    fb.hidden=false;
    img.removeAttribute("src");
  }
}

function loadQuestion(){
  const q=current();
  state={anime:false,song:false,revealed:false};

  $("#progress").textContent=`${idx+1} / ${order.length}`;
  $("#type").textContent=q.type||"OP/ED";
  $("#yearBadge").textContent=q.year?`${q.year}`:"";
  $("#animeInput").value="";
  $("#songInput").value="";
  hideSuggestions("anime");
  hideSuggestions("song");
  $("#animeFeedback").textContent="";
  $("#songFeedback").textContent="";
  $("#animeInput").disabled=false;
  $("#songInput").disabled=false;
  $("#answerbox").hidden=true;
  $("#next").disabled=true;
  $("#vocalHintText").textContent="";
  $("#vocalHint").disabled=false;

  // 정답 공개 전에는 나무위키 대표 이미지/정답 정보를 DOM에 미리 넣지 않는다.
  $("#answerAnime").textContent="";
  $("#answerSong").textContent="";
  $("#answerVocal").textContent="";
  $("#answerYear").textContent="";
  setAnswerImage("");

  setRevealedUI(false);
  setupCandidates(q);
  cueCurrentCandidate();
}

function expose(){
  state.revealed=true;
  const q=current();

  // 작품/곡을 모두 맞히거나 '정답 공개'를 눌렀을 때만
  // 나무위키 대표 이미지와 정답 정보를 표시한다.
  $("#answerAnime").textContent=q.anime||"-";
  $("#answerSong").textContent=q.song||"-";
  $("#answerVocal").textContent=q.vocal||"-";
  $("#answerYear").textContent=q.year||"-";
  setAnswerImage(q.image||"");

  $("#answerbox").hidden=false;
  $("#next").disabled=false;
  setRevealedUI(true);
}

function check(which){
  if(state.revealed||state[which])return;
  const q=current();
  const input=which==="anime"?$("#animeInput"):$("#songInput");
  const answer=which==="anime"?q.anime:q.song;
  const fb=which==="anime"?$("#animeFeedback"):$("#songFeedback");

  if(norm(input.value)===norm(answer)){
    state[which]=true;
    score++;
    $("#score").textContent=score;
    fb.textContent="정답! +1점";
    fb.className="feedback ok";
    input.disabled=true;
    hideSuggestions(which);
    if(state.anime&&state.song)expose();
  }else{
    fb.textContent="아직 정답이 아닙니다.";
    fb.className="feedback bad";
  }
}

function sourceValues(which){
  return uniq(data.map(x=>which==="anime"?x.anime:x.song));
}
function hideSuggestions(which){
  const box=which==="anime"?$("#animeSuggestions"):$("#songSuggestions");
  box.hidden=true;
  box.innerHTML="";
}
function updateSuggestions(which){
  const input=which==="anime"?$("#animeInput"):$("#songInput");
  const box=which==="anime"?$("#animeSuggestions"):$("#songSuggestions");
  const raw=input.value.trim();

  if(raw.length<2){
    hideSuggestions(which);
    return;
  }

  const n=norm(raw);
  const matches=sourceValues(which)
    .filter(v=>norm(v).includes(n))
    .slice(0,12);

  if(!matches.length){
    hideSuggestions(which);
    return;
  }

  box.innerHTML="";
  for(const value of matches){
    const item=document.createElement("button");
    item.type="button";
    item.className="suggestion-item";
    item.textContent=value;
    item.onclick=()=>{
      input.value=value;
      hideSuggestions(which);
      input.focus();
    };
    box.appendChild(item);
  }
  box.hidden=false;
}

function buildYearOptions(){
  const years=uniq(allData.map(x=>x.year).filter(Boolean)).sort((a,b)=>b-a);
  $("#yearSelect").innerHTML=years.map(y=>`<option value="${y}">${y}년</option>`).join("");
  if(years.length&&!selectedYear)selectedYear=Number(years[0]);
}
function applyMode(){
  if(selectedMode==="year"&&selectedYear){
    data=allData.filter(x=>Number(x.year)===Number(selectedYear));
  }else{
    data=[...allData];
  }

  score=0; idx=0; $("#score").textContent="0";
  if(!data.length){
    $("#game").hidden=true;
    $("#complete").hidden=true;
    $("#empty").hidden=false;
    $("#empty h2").textContent="해당 조건의 문제가 없습니다.";
    return;
  }

  order=shuffle([...data.keys()]);
  $("#empty").hidden=true;
  $("#complete").hidden=true;
  $("#game").hidden=false;
  loadQuestion();
}

function setMode(mode){
  selectedMode=mode;
  $("#modeAll").classList.toggle("active",mode==="all");
  $("#modeYear").classList.toggle("active",mode==="year");
  $("#yearSelect").hidden=mode!=="year";
  applyMode();
}

function finishQuiz(){
  if(ytReady&&ytPlayer){try{ytPlayer.pauseVideo()}catch(e){}}
  $("#game").hidden=true;
  $("#complete").hidden=false;
  $("#finalScore").textContent=score;
  $("#finalMax").textContent=` / ${order.length*2}점`;
}

document.querySelectorAll("[data-check]").forEach(b=>b.onclick=()=>check(b.dataset.check));
$("#animeInput").addEventListener("input",()=>updateSuggestions("anime"));
$("#songInput").addEventListener("input",()=>updateSuggestions("song"));
$("#animeInput").addEventListener("keydown",e=>{if(e.key==="Enter")check("anime")});
$("#songInput").addEventListener("keydown",e=>{if(e.key==="Enter")check("song")});
document.addEventListener("click",e=>{
  if(!e.target.closest(".autocomplete-wrap")){
    hideSuggestions("anime"); hideSuggestions("song");
  }
});

$("#audioPlay").onclick=()=>{if(ytReady&&ytPlayer)ytPlayer.playVideo();};
$("#audioPause").onclick=()=>{if(ytReady&&ytPlayer)ytPlayer.pauseVideo();};
$("#audioRestart").onclick=()=>{
  if(ytReady&&ytPlayer){ytPlayer.seekTo(0,true);ytPlayer.playVideo();}
};
$("#volume").oninput=e=>{if(ytReady&&ytPlayer)ytPlayer.setVolume(Number(e.target.value));};

$("#vocalHint").onclick=()=>{
  $("#vocalHintText").textContent=current().vocal||"보컬 정보 없음";
  $("#vocalHint").disabled=true;
};
$("#reveal").onclick=expose;
$("#next").onclick=()=>{
  if(ytReady&&ytPlayer){try{ytPlayer.pauseVideo()}catch(e){}}
  if(idx>=order.length-1){finishQuiz();return;}
  idx++;
  loadQuestion();
};
$("#restartQuiz").onclick=applyMode;

$("#modeAll").onclick=()=>setMode("all");
$("#modeYear").onclick=()=>setMode("year");
$("#yearSelect").onchange=e=>{
  selectedYear=Number(e.target.value);
  if(selectedMode==="year")applyMode();
};

function normalizeQuizPayload(payload){
  let rows = payload;
  if(!Array.isArray(rows) && payload && typeof payload==="object"){
    rows = payload.quiz || payload.items || payload.questions || payload.data || [];
  }
  if(!Array.isArray(rows)) return [];

  return rows.map((x,i)=>{
    if(!x || typeof x!=="object") return null;

    const anime = x.anime || x.animeTitle || x.anime_title || x.title || x.work || "";
    const song = x.song || x.songTitle || x.song_title || x.music || "";
    const vocal = x.vocal || x.artist || x.singer || "";
    const type = x.type || x.songType || x.song_type || "";
    const image = x.image || x.imageUrl || x.image_url || x.thumbnail || "";

    let ids = Array.isArray(x.videoIds) ? x.videoIds.filter(Boolean) : [];
    if(!ids.length && x.videoId) ids=[x.videoId];
    if(!ids.length && x.youtubeId) ids=[x.youtubeId];
    if(!ids.length && x.youtube_id) ids=[x.youtube_id];

    // 기존 데이터 형식을 그대로 유지하면서 UI가 쓰는 표준 필드만 보강한다.
    return {
      ...x,
      anime,
      song,
      vocal,
      type,
      image,
      videoIds:[...new Set(ids)],
      videoId:ids[0] || x.videoId || "",
      __row:i
    };
  }).filter(Boolean);
}

async function loadQuizData(){
  const url=`./data/quiz.json?v=${Date.now()}`;
  try{
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok) throw new Error(`quiz.json HTTP ${r.status}`);
    const payload=await r.json();
    const rows=normalizeQuizPayload(payload);

    // 여기서는 영상 재생 가능 여부나 대표 이미지 유무로 문제를 제거하지 않는다.
    // 대표 이미지/정답 정보는 expose() 때만 표시하고, 영상 후보 문제는 재생 단계에서 처리한다.
    allData=rows.filter(x=>x.anime || x.song);

    console.log("[ANI SONG QUIZ] quiz rows:", rows.length, "usable:", allData.length);

    if(!allData.length){
      $("#game").hidden=true;
      $("#complete").hidden=true;
      $("#empty").hidden=false;
      $("#empty h2").textContent="출제할 문제가 없습니다.";
      $("#empty p").textContent=`quiz.json 로드 성공 / 원본 ${rows.length}건 / 사용 가능 ${allData.length}건`;
      return;
    }

    $("#empty").hidden=true;
    buildYearOptions();
    data=[...allData];
    order=shuffle([...data.keys()]);
    $("#game").hidden=false;
    loadQuestion();
    injectYouTubeAPI();
  }catch(err){
    console.error("[ANI SONG QUIZ] quiz load error:",err);
    $("#game").hidden=true;
    $("#complete").hidden=true;
    $("#empty").hidden=false;
    $("#empty h2").textContent="문제 데이터를 불러오지 못했습니다.";
    $("#empty p").textContent=String(err && err.message ? err.message : err);
  }
}

loadQuizData();
