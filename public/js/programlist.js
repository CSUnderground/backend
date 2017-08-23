function sterilize(str){
	if(!str) return "UNDEFINED"
	return str.toString().replace(/</g,"&lt;").replace(/>/g,"&gt;")
}
function generateProgramCard(program,user) {
	var votePlural = (program.sumVotes === 1)?"":"s";
	var viewPlural = (program.sumViews === 1)?"":"s";
	if(user){

		return '<div class="program-card"> <div class="card"> <a href="/program/' + program.id + '"><div class="thumbnail-sizeEnforce"><div class="thumbnail-bg" style="background-image:url(https://csunderground.org/program/' + program.id + '/latest.png)"></div><div class="sizeEnforce-inside"><span class="helper"></span><img src="https://csunderground.org/program/' + program.id + '/latest.png" alt="Program Thumbnail"><div title="Community Approval" class="progress bg-danger" style="opacity:0.8;position: absolute;bottom: 0px;left: 0px;right: 0px;border-radius: 0px;height: 7px;"><div class="progress-bar bg-success" style="width: ' + (Math.round(program.positivePercentage*100).toString()) + '%"></div></div></div></div> </a> <p class="card-text title"><a href="/program/' + program.id + '">' + sterilize(program.name) + '</a></p> <p class="card-text creator"><a href="/profile/' + sterilize(user.username) + '">' + sterilize(user.displayName)  + '</a></p> <p class="card-text stats">' + program.sumVotes + ' Vote'+ votePlural +' · ' + program.sumViews + ' View'+ viewPlural +'</p> </div> </div>';
	}else{
		return '<div class="program-card"> <div class="card"> <a href="/program/' + program.id + '"><div class="thumbnail-sizeEnforce"><div class="thumbnail-bg" style="background-image:url(https://csunderground.org/program/' + program.id + '/latest.png)"></div><div class="sizeEnforce-inside"><span class="helper"></span><img src="https://csunderground.org/program/' + program.id + '/latest.png" alt="Program Thumbnail"><div title="Community Approval" class="progress bg-danger" style="opacity:0.8;position: absolute;bottom: 0px;left: 0px;right: 0px;border-radius: 0px;height: 7px;"><div class="progress-bar bg-success" style="width: ' + (Math.round(program.positivePercentage*100).toString()) + '%"></div></div></div></div> </a> <p class="card-text title"><a href="/program/' + program.id + '">' + sterilize(program.name) + '</a></p> <p class="card-text creator"><a href="/profile/' + sterilize(program.owner.username) + '">' + sterilize(program.owner.displayName)  + '</a></p> <p class="card-text stats">' + program.sumVotes + ' Vote'+ votePlural +' · ' + program.sumViews + ' View'+ viewPlural +'</p> </div> </div>';
	}
}