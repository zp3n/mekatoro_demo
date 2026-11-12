const canvas = document.getElementById('rectangle');
const cvs = canvas.getContext('2d');
onload = function() {
  draw();
};
 
function draw() {
  if ( ! canvas || ! canvas.getContext ) {
    return false;
  }
  var x;
  for(var i=0;i<10;i++){
    if(i<6){x=7}else{x=5}
    for(var j=0;j<x;j++){
    cvs.fillStyle = "black"
    cvs.strokeRect(i*40,j*40,40,40); // (50,50)の位置に100x100のサイズの四角形を描く
    cvs.fillStyle = "#ddd";
    // (10, 10) の位置に 100×100 ピクセルのサイズの矩形を追加
    cvs.fillRect(i*40,j*40,40,40);
    }
  }
  
}
