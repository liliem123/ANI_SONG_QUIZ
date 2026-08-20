let player=null, ready=false, pending=null;
const bc=new BroadcastChannel("quiz-host-player-v1");
const $=s=>document.querySelector(s);

function apply(msg){
  if(!msg)return;
  pending=msg;
  if(!ready||!player)return;
  try{
    if(msg.type==="load" && msg.videoId){
      player.loadVideoById({videoId:msg.videoId,startSeconds:Number(msg.position||0)});
      player.setVolume(100);
      if(msg.state==="paused") setTimeout(()=>player.pauseVideo(),250);
      $("#status").textContent=`영상 준비: ${msg.videoId}`;
    }else if(msg.type==="play"){
      if(Number.isFinite(msg.position))player.seekTo(Number(msg.position),true);
      player.playVideo();
      $("#status").textContent="재생 중";
    }else if(msg.type==="pause"){
      if(Number.isFinite(msg.position))player.seekTo(Number(msg.position),true);
      player.pauseVideo();
      $("#status").textContent="일시정지";
    }else if(msg.type==="restart"){
      player.seekTo(0,true);player.playVideo();
      $("#status").textContent="처음부터 재생";
    }
  }catch(e){$("#status").textContent=`오류: ${e.message||e}`;}
}
bc.onmessage=e=>apply(e.data);

window.onYouTubeIframeAPIReady=()=>{
  player=new YT.Player("player",{
    width:"100%",height:"100%",videoId:"",
    playerVars:{controls:0,disablekb:1,rel:0,playsinline:1,fs:0},
    events:{
      onReady:()=>{ready=true;player.setVolume(100);$("#status").textContent="준비 완료";if(pending)apply(pending);bc.postMessage({type:"ready"});},
      onStateChange:e=>{
        if(e.data===YT.PlayerState.PLAYING)$("#status").textContent="재생 중";
        if(e.data===YT.PlayerState.PAUSED)$("#status").textContent="일시정지";
      }
    }
  });
};
const s=document.createElement("script");
s.src="https://www.youtube.com/iframe_api";
document.head.appendChild(s);
window.addEventListener("beforeunload",()=>bc.close());
