let data=[], order=[], idx=0, score=0, state=null;
let ytPlayer=null, ytReady=false, apiLoaded=false, pendingVideoId=null;
let candidateIds=[], candidateIndex=0, candidateTried=[];
const $=s=>document.querySelector(s);

function norm(s){
  return (s||"").normalize("NFKC").toLowerCase()
    .replace(/[\s·・'"“”‘’!?.,:;()[\]{}\-_/]/g,"");
}
function uniq(xs){return [...new Set(xs.filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));}
function fillList(id, values){
  $(id).innerHTML=values.map(v=>`<option value="${String(v).replaceAll('"','&quot;')}">`).join("");
}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function current(){return data[order[idx]];}

function setStatus(text){ $("#playerStatus").textContent=text; }

function setDiag(text){ $("#diag").textContent=text ? ` · ${text}` : ""; }
function setCandidateText(text){
  const el=$("#candidateText");
  if(el) el.textContent=text||"";
}

function getBlockedMap(){
  try{
    const raw=localStorage.getItem("namuOpedBlockedVideosV17");
    const obj=raw ? JSON.parse(raw) : {};
    return obj && typeof obj==="object" ? obj : {};
  }catch(e){
    return {};
  }
}

function saveBlockedMap(obj){
  try{
    localStorage.setItem("namuOpedBlockedVideosV17",JSON.stringify(obj));
  }catch(e){}
}

async function blockCandidate(videoId, errorCode, reason){
  const q=current();
  if(!videoId) return;

  const blocked=getBlockedMap();
  blocked[videoId]={
    errorCode,
    reason,
    anime:q?.anime || "",
    song:q?.song || ""
  };
  saveBlockedMap(blocked);
}

function currentCandidate(){
  return candidateIds[candidateIndex] || "";
}

function setupCandidates(q){
  const raw = Array.isArray(q.videoIds) && q.videoIds.length
    ? q.videoIds
    : (q.videoId ? [q.videoId] : []);

  candidateIds=[...new Set(raw.filter(Boolean))];
  candidateIndex=0;
  candidateTried=[];
  setDiag(`후보 ${candidateIds.length}개`);
  setCandidateText(`YouTube 후보 ${candidateIds.length}개`);
}

function cueCurrentCandidate(){
  const vid=currentCandidate();
  if(!vid){
    setStatus("재생 가능한 후보 영상 없음");
    setDiag("모든 후보 실패");
    $("#skipBlocked").disabled=true;
    return;
  }

  if(!candidateTried.includes(vid)) candidateTried.push(vid);
  setDiag(`후보 ${candidateIndex+1}/${candidateIds.length} · ${vid}`);
  setCandidateText(`후보 ${candidateIndex+1}/${candidateIds.length}`);
  cueVideo(vid);
}

async function failCurrentCandidate(errorCode, reason){
  const failed=currentCandidate();
  if(failed){
    await blockCandidate(failed,errorCode,reason);
  }

  if(candidateIndex + 1 < candidateIds.length){
    candidateIndex++;
    setStatus(`다음 YouTube 후보로 전환 중... (${candidateIndex+1}/${candidateIds.length})`);
    setTimeout(cueCurrentCandidate,350);
    return;
  }

  setStatus("이 곡의 YouTube 후보가 모두 재생 불가입니다.");
  setDiag(`모든 후보 실패 (${candidateIds.length}개)`);
  setCandidateText("재생 가능한 후보 없음");
  $("#skipBlocked").disabled=true;
  $("#answerbox").hidden=false;
  $("#next").disabled=false;
}

function injectYouTubeAPI(){
  if(apiLoaded) return;
  apiLoaded=true;

  // 중요: callback을 먼저 정의한 뒤 API script를 삽입한다.
  const tag=document.createElement("script");
  tag.src="https://www.youtube.com/iframe_api";
  tag.async=true;
  tag.onerror=()=>setStatus("YouTube API 로드 실패");
  document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady=function(){
  setStatus("YouTube 플레이어 생성 중...");

  ytPlayer=new YT.Player("player",{
    width:"480",
    height:"270",
    videoId:"",
    playerVars:{
      controls:1,
      rel:0,
      playsinline:1,
      fs:1,
      origin:location.origin
    },
    events:{
      onReady:()=>{
        ytReady=true;
        setStatus("재생 준비 완료");
        setDiag(`origin=${location.origin}`);
        ytPlayer.setVolume(Number($("#volume").value)||70);
        if(pendingVideoId) cueVideo(pendingVideoId);
      },
      onStateChange:e=>{
        if(e.data===YT.PlayerState.UNSTARTED) setStatus("재생 준비 완료");
        else if(e.data===YT.PlayerState.ENDED) setStatus("재생 종료");
        else if(e.data===YT.PlayerState.PLAYING) setStatus("재생 중");
        else if(e.data===YT.PlayerState.PAUSED) setStatus("일시정지");
        else if(e.data===YT.PlayerState.BUFFERING) setStatus("버퍼링 중...");
        else if(e.data===YT.PlayerState.CUED) setStatus("재생 준비 완료");
      },
      onError:e=>{
        const messages={
          2:"잘못된 YouTube 영상 ID",
          5:"HTML5 플레이어 오류",
          100:"삭제되었거나 비공개 영상",
          101:"외부 사이트 재생이 허용되지 않는 영상",
          150:"외부 사이트 재생이 허용되지 않는 영상",
          153:"HTTP Referer 또는 API Client 식별 정보 부족"
        };
        const msg=messages[e.data]||`YouTube 오류 (${e.data})`;
        setStatus(msg);

        if([100,101,150].includes(e.data)){
          setTimeout(()=>failCurrentCandidate(e.data,msg),300);
        }else{
          setDiag(`error=${e.data} · 후보 ${candidateIndex+1}/${candidateIds.length}`);
        }
      },
      onAutoplayBlocked:()=>{
        setStatus("브라우저가 자동 재생을 차단했습니다. 플레이어의 ▶ 버튼을 눌러주세요.");
      }
    }
  });
};

function cueVideo(id){
  pendingVideoId=id;
  if(!ytReady || !ytPlayer){
    setStatus("YouTube 플레이어 준비 중...");
    return;
  }
  try{
    ytPlayer.cueVideoById({videoId:id,startSeconds:0});
    ytPlayer.setVolume(Number($("#volume").value)||70);
    setStatus("재생 준비 완료");
  }catch(e){
    setStatus("영상 준비 실패");
  }
}

function playVideo(){
  if(!ytReady || !ytPlayer){
    setStatus("YouTube 플레이어 준비 중...");
    return;
  }
  try{
    ytPlayer.playVideo();
    setStatus("재생 요청 중...");
  }catch(e){
    setStatus("재생 명령 실패");
  }
}
function pauseVideo(){
  if(ytReady && ytPlayer){
    try{ytPlayer.pauseVideo()}catch(e){}
  }
}
function restartVideo(){
  if(ytReady && ytPlayer){
    try{
      ytPlayer.seekTo(0,true);
      ytPlayer.playVideo();
    }catch(e){}
  }
}

function setRevealedUI(revealed){
  const stage=$("#youtubeStage");
  const curtain=$("#videoCurtain");
  if(revealed){
    stage.classList.add("revealed");
    if(curtain) curtain.hidden=true;
  }else{
    stage.classList.remove("revealed");
    if(curtain) curtain.hidden=false;
  }
}

function loadQuestion(){
  const q=current();
  state={anime:false,song:false,revealed:false};

  $("#progress").textContent=`${idx+1} / ${order.length}`;
  $("#type").textContent=q.type||"OP/ED";
  $("#animeInput").value="";
  $("#songInput").value="";
  $("#animeFeedback").textContent="";
  $("#songFeedback").textContent="";
  $("#animeInput").disabled=false;
  $("#songInput").disabled=false;
  $("#answerbox").hidden=true;
  $("#next").disabled=true;
  $("#vocalHintText").textContent="";
  $("#vocalHint").disabled=false;

  $("#answerAnime").textContent=q.anime||"-";
  $("#answerSong").textContent=q.song||"-";
  $("#answerVocal").textContent=q.vocal||"-";

  setRevealedUI(false);
  $("#skipBlocked").disabled=false;
  setupCandidates(q);
  cueCurrentCandidate();
}

function expose(){
  state.revealed=true;
  $("#answerbox").hidden=false;
  $("#next").disabled=false;
  setRevealedUI(true);
}

function check(which){
  if(state.revealed || state[which])return;

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

    if(state.anime && state.song) expose();
  }else{
    fb.textContent="아직 정답이 아닙니다.";
    fb.className="feedback bad";
  }
}

document.querySelectorAll("[data-check]").forEach(b=>b.onclick=()=>check(b.dataset.check));
$("#animeInput").addEventListener("keydown",e=>{if(e.key==="Enter")check("anime")});
$("#songInput").addEventListener("keydown",e=>{if(e.key==="Enter")check("song")});

$("#audioPlay").onclick=playVideo;
$("#audioPause").onclick=pauseVideo;
$("#audioRestart").onclick=restartVideo;
$("#skipBlocked").onclick=()=>failCurrentCandidate("manual","사용자 수동 제외");
$("#volume").oninput=e=>{
  if(ytReady&&ytPlayer){
    try{ytPlayer.setVolume(Number(e.target.value))}catch(err){}
  }
};

$("#vocalHint").onclick=()=>{
  $("#vocalHintText").textContent=current().vocal||"보컬 정보 없음";
  $("#vocalHint").disabled=true;
};

$("#reveal").onclick=expose;

function finishQuiz(){
  pauseVideo();
  $("#game").hidden=true;
  $("#complete").hidden=false;
  $("#finalScore").textContent=score;
  $("#finalMax").textContent=` / ${order.length*2}점`;
}

$("#next").onclick=()=>{
  pauseVideo();

  if(idx >= order.length-1){
    finishQuiz();
    return;
  }

  idx++;
  loadQuestion();
};

$("#restartQuiz").onclick=()=>{
  score=0;
  idx=0;
  $("#score").textContent="0";
  order=shuffle([...data.keys()]);
  $("#complete").hidden=true;
  $("#game").hidden=false;
  loadQuestion();
};

function applyLocalBlocked(items){
  const blocked=getBlockedMap();
  const output=[];

  for(const x of items){
    const raw = Array.isArray(x.videoIds) && x.videoIds.length
      ? x.videoIds
      : (x.videoId ? [x.videoId] : []);

    const ids=raw.filter(v=>v && !blocked[v]);
    if(!ids.length) continue;

    output.push({...x,videoIds:ids,videoId:ids[0]});
  }
  return output;
}

fetch("./data/quiz.json")
  .then(r=>r.json())
  .then(xs=>{
    data=applyLocalBlocked(xs).filter(x=>(x.videoIds&&x.videoIds.length)||x.videoId);

    if(!data.length){
      $("#empty").hidden=false;
      return;
    }

    order=shuffle([...data.keys()]);
    fillList("#animeList",uniq(data.map(x=>x.anime)));
    fillList("#songList",uniq(data.map(x=>x.song)));
    $("#game").hidden=false;

    loadQuestion();
    injectYouTubeAPI();
  })
  .catch(err=>{
    console.error(err);
    $("#empty").hidden=false;
    const p=$("#empty p");
    if(p) p.textContent="data/quiz.json을 불러오지 못했습니다. GitHub Pages 배포 경로와 파일 위치를 확인해주세요.";
  });
