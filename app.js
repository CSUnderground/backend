var credentials = require("./credentials.js")
var restify = require("restify");
var corsMiddleware = require("restify-cors-middleware");
var bodyParser = require("body-parser");
var DDOS = require("ddos");
var fs = require("fs");
var reCAPTCHA=require('recaptcha2')
var httpsCerts = {
    key: fs.readFileSync(credentials.ssl.keyLocation),
    cert: fs.readFileSync(credentials.ssl.certLocation)
};
var server = restify.createServer(httpsCerts);
var mongodb = require("mongodb").MongoClient;

var mongourl = credentials.mongourl;
/*
Register error callbacks
 */

function getNextIterate(type, db, callback){
    var iterators = db.collection("iterators");
    iterators.findOne({
        type:type
    }, function(err,doc){
        if(err || !doc){
            if(err){
                console.log(err)
                return;
            }
            callback(1);
            iterators.insertOne({type:type,count:2})
            return;
        }
        callback(doc.count)
        iterators.update(doc,{$set: {count: (doc.count + 1)}}, function(err){
            if(err){
                console.log(err)
            }
        })
    })
}
function handle404(res) {
    res.send(404,{
        err: "Invalid api path."
    })
}
//var ddos = new DDOS({burst:10,maxexpiry:5,errormessage:"<h1>Chill!</h1><p>You're sending too many requests too quickly. Please tone it down.</p>"});
//server.use(ddos.express)
server.on('NotFound', function(req, res, err, callback) {
    handle404(res);
});

var CORS = corsMiddleware({
    origins: ['*'],
    allowHeaders: ['CSU-Session-ID']
    //exposeHeaders: ['API-Token-Expiry']
});
server.pre(CORS.preflight);
server.use(CORS.actual);
server.use(bodyParser.json({ mapParams: false, limit: '1mb'}));
server.use(restify.plugins.queryParser());
/*
Register routes
 */
function generateUserId(db,callback) {
    var idLen = 10;
    getNextIterate("users",db,function(num){
        var str = (num).toString();
        while(str.length < idLen){
            str = "0" + str;
        }
        return callback(str);
    })
}

var programIDLength = 10;
function generateProgramId(db,callback) {
    var idLen = programIDLength;
    var chars = "0123456789abcdef".split("");
    var generatedID = "";
    for(var i = 0; i < idLen; i++){
        generatedID += chars[Math.floor(Math.random() * chars.length)];
    }
    isProgram(generatedID, function(exists){
        if(!exists){
            callback(generatedID);
        }else{
            generateProgramId(db, callback);
        }
    })
}

mongodb.connect(mongourl, function(err, db){
    if(err){
        console.log(err);
        if(db){
            db.close();
        }
        return;
    } 
    db.close();
    var programs = db.collection("programs");
    /*programs.find({}).each(function(err,doc){
        if(doc){
            generateProgramId(db, function(myID) {
                console.log(myID);
                programs.findOneAndUpdate({id: doc.id}, {$set:{id: myID}}, function(err,result){
                    console.log(err)
                })
            });
        }
    });*/
});

function cleanProgram(program,callback){
    var doc = program;
    delete doc._id;
    delete doc.views;
    delete doc.votes;
    doc.spinOffs=0;
    if(!callback){
        return doc; // dont resolve owner.
    }
    getAccountByID(doc.owner, function(account){
        doc.owner = account;
        delete doc.owner.auth;
        delete doc.owner.editor;
        delete doc.owner._id;
        delete doc.owner.id;
        if(doc.owner.authLevel < 1){
            delete doc.owner.authLevel;
        }
        callback(doc);
    })
}
function getProgramDirty(id, callback){
    if (id.length === programIDLength) {
        mongodb.connect(mongourl, function(err, db){
            if(err){
            	db.close();
            	return callback();
            } 
            var programs = db.collection("programs");
            programs.findOne({id:id}, function(err, doc){
                if(doc){
                    delete doc.votes;
                    delete doc.views;
                    callback(doc);
                    db.close();
                }else{
                    callback();
                    db.close();
                }
            });
        });
    }
}

function isProgram(id, callback){
    if (id.length === programIDLength) {
        mongodb.connect(mongourl, function(err, db){
            if(err){
                db.close();
                return callback();
            } 
            var programs = db.collection("programs");
            programs.findOne({id:id}, function(err, doc){
                var exists = false;
                if(doc){
                    exists = true;
                }
                callback(exists)
                db.close();
            });
        });
    }
}
function getProgram(id,callback, voteCheckAccount){
    if ( id.length === programIDLength) {
        mongodb.connect(mongourl, function(err, db){
            if(err){
            	db.close();
            	return callback();
         	}
            var programs = db.collection("programs");
            programs.findOne({id:id}, function(err, doc){
                if(doc){
                    
                    var vot = 0;
                    if(voteCheckAccount){
                        if(doc.votes.hasOwnProperty(voteCheckAccount)){
                            vot = doc.votes[voteCheckAccount];
                        }
                    }
                    cleanProgram(doc,function(program) {
                        if(voteCheckAccount){
                            callback(program,vot);
                            db.close();
                        }else{
                            callback(program);
                            db.close();
                        }
                    })
                }else{
                    callback();
                    db.close();
                }
            });
        });
    }else{
    	callback();
    }
}
server.get("/v1/account/:username",function(req,res,next){
    getAccountByUsername(req.params.username, function(account){
        if(account){
            delete account._id;
            delete account.auth;
            delete account.editor;
            delete account.id;
            if(account.authLevel <= 0){
                delete account.authLevel;
            }
            res.send(account);

        }else{
            res.send(404, {
                err: "User does not exist."
            });
        }
    })
});
server.get("/v1/account/:username/programs",function(req,res,next){
    getAccountByUsername(req.params.username, function(account){
        if(account){
            mongodb.connect(mongourl, function(err, db){
                if(err){
                    res.send(500, {
                        err: "DB connection failure"
                    });
                    db.close();
                    return;
                }
                var programs = db.collection("programs");
                var safe = [];
                programs.find({owner:account.id}).sort({"currentRevision.updated":-1}).limit(25).toArray(function(err, programs){
                    if(err){
                        res.send(500, {
                            err: "Error fetching user programs."
                        });
                        db.close();
                        return;
                    }
                    for(var i in programs){
                        var program = cleanProgram(programs[i]);
                        delete program.owner;
                        delete program.currentRevision.code;
                        delete program.currentRevision.thumbnail;
                        delete program.revisions;
                        safe.push(program);
                    }
                    delete account._id;
                    delete account.auth;
                    delete account.id;
                    res.send({
                        account:account,
                        programs:safe
                    })
                    db.close();
                });
            });
        }else{
            res.send(404, {
                err: "User does not exist."
            });
            db.close();
        }
    })
});
server.get("/v1/program/:id",function(req,res,next){
    getProgram(req.params.id, function(doc){
        if(doc){
            delete doc._id;
            delete doc.currentRevision.thumbnail
            res.send(doc);
        }else{
            res.send(500, {
                err: "Could not get program with id of \"" + req.params.id + "\"."
            });
        }
    })
});
function getRecentUpdated(page, maxCount,callback){
    mongodb.connect(mongourl, function(err, db){
        if(err){db.close(); return callback();}
        var programs = db.collection("programs");
        programs.find().sort({"currentRevision.updated":-1}).skip(page*maxCount).limit(maxCount).toArray(function(err, docs){
            if(err){db.close(); return callback();}
            var prg = [];
            var ownerIDs = []; 
            for(var i = 0; i >= 0 && i < docs.length; i++){ //TODO: Don't reverse this.
                if(docs[i]){
                    var prog = cleanProgram(docs[i]);
                    delete prog.currentRevision.code;
                    delete prog.currentRevision.thumbnail;
                    delete prog.revisions;
                    delete prog.type;
                    ownerIDs.push(prog.owner);
                    prg.push(prog);
                }
            }
            var accounts = db.collection("accounts");
            accounts.find(/*{id: {$all:ownerIDs}}*/).toArray(function(err, found){ // TODO: Fix logic
                for(var i in prg){
                    for(var z in found){
                        if(found[z].id == prg[i].owner){
                            var fixedAccount = {
                                displayName:found[z].displayName,
                                username:found[z].username
                            }
                            prg[i].owner = fixedAccount;
                        }
                    }
                }
                callback(prg);
                db.close();
            })
        })
    });
}
function getRecentCreated(page, maxCount,callback){
    mongodb.connect(mongourl, function(err, db){
        if(err){db.close(); return callback();}
        var programs = db.collection("programs");
        programs.find().sort({"created":-1}).skip(page*maxCount).limit(maxCount).toArray(function(err, docs){
            if(err){db.close(); return callback();}
            var prg = [];
            var ownerIDs = []; 
            for(var i = 0; i >= 0 && i < docs.length; i++){ //TODO: Don't reverse this.
                if(docs[i]){
                    var prog = cleanProgram(docs[i]);
                    delete prog.currentRevision.code;
                    delete prog.currentRevision.thumbnail;
                    delete prog.revisions;
                    delete prog.type;
                    ownerIDs.push(prog.owner);
                    prg.push(prog);
                }
            }
            var accounts = db.collection("accounts");
            accounts.find(/*{id: {$all:ownerIDs}}*/).toArray(function(err, found){ // TODO: Fix logic
                for(var i in prg){
                    for(var z in found){
                        if(found[z].id == prg[i].owner){
                            var fixedAccount = {
                                displayName:found[z].displayName,
                                username:found[z].username
                            }
                            prg[i].owner = fixedAccount;
                        }
                    }
                }
                callback(prg);
                db.close();
            })
        })
    });
}
function getTopVoted(page, maxCount,callback){
    mongodb.connect(mongourl, function(err, db){
        if(err){db.close(); return callback();}
        var programs = db.collection("programs");
        programs.find().sort({"sumVotes":-1}).skip(page*maxCount).limit(maxCount).toArray(function(err, docs){
            if(err){db.close(); return callback();}
            var prg = [];
            var ownerIDs = []; 
            for(var i = 0; i >= 0 && i < docs.length; i++){ //TODO: Don't reverse this.
                if(docs[i]){
                    var prog = cleanProgram(docs[i]);
                    delete prog.currentRevision.code;
                    delete prog.currentRevision.thumbnail;
                    delete prog.revisions;
                    delete prog.type;
                    ownerIDs.push(prog.owner);
                    prg.push(prog);
                }
            }
            var accounts = db.collection("accounts");
            accounts.find(/*{id: {$all:ownerIDs}}*/).toArray(function(err, found){ // TODO: Fix logic
                for(var i in prg){
                    for(var z in found){
                        if(found[z].id == prg[i].owner){
                            var fixedAccount = {
                                displayName:found[z].displayName,
                                username:found[z].username
                            }
                            prg[i].owner = fixedAccount;
                        }
                    }
                }
                callback(prg);
                db.close();
            })
        })
    });
}
function getTopViewed(page, maxCount,callback){
    mongodb.connect(mongourl, function(err, db){
        if(err){db.close(); return callback();}
        var programs = db.collection("programs");
        programs.find().sort({"sumViews":-1}).skip(page*maxCount).limit(maxCount).toArray(function(err, docs){
            if(err){db.close(); return callback();}
            var prg = [];
            var ownerIDs = []; 
            for(var i = 0; i >= 0 && i < docs.length; i++){ //TODO: Don't reverse this.
                if(docs[i]){
                    var prog = cleanProgram(docs[i]);
                    delete prog.currentRevision.code;
                    delete prog.currentRevision.thumbnail;
                    delete prog.revisions;
                    delete prog.type;
                    ownerIDs.push(prog.owner);
                    prg.push(prog);
                }
            }
            var accounts = db.collection("accounts");
            accounts.find(/*{id: {$all:ownerIDs}}*/).toArray(function(err, found){ // TODO: Fix logic
                for(var i in prg){
                    for(var z in found){
                        if(found[z].id == prg[i].owner){
                            var fixedAccount = {
                                displayName:found[z].displayName,
                                username:found[z].username
                            }
                            prg[i].owner = fixedAccount;
                        }
                    }
                }
                callback(prg);
                db.close();
            })
        })
    });
}
function getHot(page, maxCount, callback){
    mongodb.connect(mongourl, function(err, db){
        if(err){db.close(); return callback();}
        var programs = db.collection("programs");
        //var weekAgo = Date.now() - (1000*60*60*24*7) /* programs from this last week */;
        programs.find({}).sort({"created":-1}).toArray(function(err, programs){
        	if(err){db.close(); return callback();}
            var heatLevels=[];
            for(var i in programs){
                var prog = programs[i];
                var sign = Math.sign(prog.sumVotes);
                var voteCount = 0;
                for(var i in prog.votes){
                    voteCount++;
                }
                var sumVotes = prog.sumVotes-1;
                var popularityVal = sumVotes + (voteCount / 10) + ((prog.sumViews - voteCount)/100);
                var order = Math.log(Math.max(Math.abs(popularityVal),1),10);
                var sec = Date.now() - 1134028003;
                heatLevels.push([prog,(sign * order + sec / 45000)]);
            }
            heatLevels.sort(function(a,b){
                if(a[1] < b[1]){
                    return 1
                }else if(a[1] > b[1]){
                    return -1
                }
                return 0
            })
            var hotPrograms = [];
            var ownerIDs = [];
            var skip = 0;
            var toSkip = maxCount*page;
            for(var i in heatLevels){
                if(skip < toSkip){
                    skip++; continue;
                }
                if(hotPrograms.length >= maxCount) continue;
                var cleanProg = cleanProgram(heatLevels[i][0]);
                delete cleanProg.currentRevision.code;
                delete cleanProg.currentRevision.folds;
                delete cleanProg.currentRevision.thumbnail;
                delete cleanProg.revisions;
                delete cleanProg.type;
                cleanProg.heat = heatLevels[i][1];
                ownerIDs.push(prog.owner);
                hotPrograms.push(cleanProg)

            }
            var accounts = db.collection("accounts");
            accounts.find(/*{id: {$all:ownerIDs}}*/).toArray(function(err, found){ // TODO: Fix logic
                for(var i in hotPrograms){
                    for(var z in found){
                        if(found[z].id == hotPrograms[i].owner){
                            var fixedAccount = {
                                displayName:found[z].displayName,
                                username:found[z].username
                            }
                            hotPrograms[i].owner = fixedAccount;
                        }
                    }
                }
                callback(hotPrograms);
                db.close()
            })
        })
    });
}
server.get("/v1/users", function(req, res, next){
    mongodb.connect(mongourl, function(err, db){
        if(err){
            res.send(500, {
                error:"DB Error!"
            })
            db.close();
            return;
        }
        var accounts = db.collection("accounts");
        accounts.find({}).toArray(function(err, accounts){
            if(err){
                res.send(500, {
                    error:"DB Error!"
                })
                db.close();
                return;
            }
            for(var i in accounts){
                delete accounts[i]._id;
                delete accounts[i].auth;
                delete accounts[i].editor;
                delete accounts[i].id;
            }
            res.send({
                users:accounts
            })
            db.close();
        })
    })
})
server.get("/v1/programs/recentUpdated", function(req, res, next){
    var page = 0;
    if(req.query.hasOwnProperty("page")){
        if(!isNaN(req.query.page)){
            page = parseFloat(req.query.page)-1;
        }
    }
    getRecentUpdated(page,25,function(programs){
        if(programs){
            res.send({
                programs: programs,
                updatedAt:Date.now()
            });
        }else{
            res.send(500, {
                error:"Failed to fetch programs. Contact an administrator."
            })
        }
    })
});
server.get("/v1/programs/recentCreated", function(req, res, next){
    var page = 0;
    if(req.query.hasOwnProperty("page")){
        if(!isNaN(req.query.page)){
            page = parseFloat(req.query.page)-1;
        }
    }
    getRecentCreated(page,25,function(programs){
        if(programs){
            res.send({
                programs: programs,
                updatedAt:Date.now()
            });
        }else{
            res.send(500, {
                error:"Failed to fetch programs. Contact an administrator."
            })
        }
    })
});
server.get("/v1/programs/hot", function(req, res, next){
    var page = 0;
    if(req.query.hasOwnProperty("page")){
        if(!isNaN(req.query.page)){
            page = parseFloat(req.query.page)-1;
        }
    }
    getHot(page,25,function(programs){
        if(programs){
            res.send({
                programs: programs,
                updatedAt:Date.now()
            });
        }else{
            res.send(500, {
                error:"Failed to fetch programs. Contact an administrator."
            })
        }
    })
});
server.get("/v1/programs/top-viewed", function(req, res, next){
    var page = 0;
    if(req.query.hasOwnProperty("page")){
        if(!isNaN(req.query.page)){
            page = parseFloat(req.query.page)-1;
        }
    }
    getTopViewed(page,25,function(programs){
        if(programs){
            res.send({
                programs: programs,
                updatedAt:Date.now()
            });
        }else{
            res.send(500, {
                error:"Failed to fetch programs. Contact an administrator."
            })
        }
    })
});
server.get("/v1/programs/top-voted", function(req, res, next){
    var page = 0;
    if(req.query.hasOwnProperty("page")){
        if(!isNaN(req.query.page)){
            page = parseFloat(req.query.page)-1;
        }
    }
    getTopVoted(page,25,function(programs){
        if(programs){
            res.send({
                programs: programs,
                updatedAt:Date.now()
            });
        }else{
            res.send(500, {
                error:"Failed to fetch programs. Contact an administrator."
            })
        }
    })
});

server.del("/v1/program/:id", function(req, res, next){
    if(!req.headers["csu-session-id"]){
        res.send({
            success:false,
            reason:"User must be authenticated."
        })
        return;
    }
    var sessionID = req.headers["csu-session-id"];
    if(isValidSession(sessionID)){
        getAccountByID(activeSessionIDs[sessionID].userid, function(account){
            if(!account){
                res.send({
                    success:false,
                    reason:"Session attached to null user? Contact developer."
                });
            }else{
                getProgramDirty(req.params.id, function(program){
                    if(!program){
                        res.send({
                            success:false,
                            reason:"Invalid program id."
                        });
                        return;
                    }
                    if(account.id == program.owner || account.authLevel > modLevels.USER){
                        mongodb.connect(mongourl,function(err,db){
                            if(err){
                                res.send({
                                    success:false,
                                    reason:"DB Connection failure."
                                });
                                db.close();
                                return;
                            }
                            db.collection("programs").findOneAndDelete({id:req.params.id},function(err, result){
                                if(!err){
                                    res.send({
                                        success:true
                                    });
                                }else{
                                    res.send({
                                        success:false,
                                        reason:"DB failed to delete."
                                    });
                                }
                                db.close();
                            })
                        })
                    }else{
                        res.send({
                            success:false,
                            reason:"No permission to delete program."
                        });
                    }
                })
            }
        })
        
    }else{
        res.send({
            success:false,
            reason:"Invalid session. Please log in again."
        })
    }
});
server.put("/v1/program/:id", function(req, res, next){
    if(!req.headers["csu-session-id"]){
        res.send({
            success:false,
            reason:"User must be authenticated."
        })
        return;
    }
    var sessionID = req.headers["csu-session-id"];
    if(isValidSession(sessionID)){
        //console.log(activeSessionIDs[sessionID])
        getAccountByID(activeSessionIDs[sessionID].userid, function(account){
            if(!account){
                res.send({
                    success:false,
                    reason:"Session attached to null user? Contact developer."
                });
            }else{
                getProgramDirty(req.params.id, function(program){
                    if(!program){
                        res.send({
                            success:false,
                            reason:"Invalid program id."
                        });
                        return;
                    }
                    if(account.id == program.owner || account.authLevel > modLevels.USER){
                        mongodb.connect(mongourl,function(err, db){
                            if(err){
                                res.send(500,{
                                    success:false,
                                    reason:"Internal server error: DB Connection failed."
                                });
                                db.close();
                                return;
                            }
                            var safeModify = {
                                name: program.name,
                                currentRevision:{
                                    dimensions:program.currentRevision.dimensions,
                                    code: program.currentRevision.code,
                                    folds: program.currentRevision.folds,
                                    thumbnail: program.currentRevision.thumbnail,
                                    loopProtect: program.currentRevision.loopProtect,
                                    updated:Date.now()
                                }
                            };
                            if(req.body.hasOwnProperty("dimensions")) safeModify.currentRevision.dimensions = req.body.dimensions;
                            if(req.body.hasOwnProperty("name")) safeModify.name = req.body.name;
                            if(req.body.hasOwnProperty("code")) safeModify.currentRevision.code = req.body.code;
                            if(req.body.hasOwnProperty("folds")) safeModify.currentRevision.folds = req.body.folds;
                            if(req.body.hasOwnProperty("thumbnail")) safeModify.currentRevision.thumbnail = req.body.thumbnail;
                            if(req.body.hasOwnProperty("loopProtect")) safeModify.currentRevision.loopProtect = req.body.loopProtect;
                            db.collection("programs").findOneAndUpdate({id:req.params.id},{$set: safeModify}, function(err, results){
                                if(!err){
                                    res.send({
                                        success:true,
                                        reason:"Program successfully modified."
                                    });
                                }else{
                                    res.send(500,{
                                        success:false,
                                        reason:"Error updating program."
                                    });
                                    console.log(err)
                                }
                                db.close();
                            })
                            
                        })
                        
                    }else{
                        res.send({
                            success:false,
                            reason:"No permission to modify program."
                        });
                    }
                })
            }
        })
        
    }else{
        res.send({
            success:false,
            reason:"Invalid session. Please log in again."
        })
    }
});

/*server.del("/v1/program/:id", function(req, res, next){
    if(!req.headers["csu-session-id"]){
        res.send({
            success:false,
            reason:"User must be authenticated."
        })
        return;
    }
    var sessionID = req.headers["csu-session-id"];
    if(isValidSession(sessionID)){
        res.send({
            success:false,
            reason:"Deletion is not implemented. :3"
        });
    }else{
        res.send({
            success:false,
            reason:"Invalid session. Please log in again."
        })
    }
});*/
server.post("/v1/program/:id/view", function(req, res, next){
    if(!req.headers["csu-session-id"]){
        res.send({
            success:false,
            reason:"User must be authenticated."
        })
        return;
    }
    var sessionID = req.headers["csu-session-id"];
    if(isValidSession(sessionID)){
        //console.log(activeSessionIDs[sessionID])
        getAccountByID(activeSessionIDs[sessionID].userid, function(account){
            if(!account){
                res.send({
                    success:false,
                    reason:"Session attached to null user? Contact developer."
                });
            }else{
                mongodb.connect(mongourl, function(err, db){
                    if(err){
                        res.send({
                            success:false,
                            reason:"DB Connection error"
                        })
                        db.close();
                        return;
                    }
                    var programs = db.collection("programs");
                    programs.findOne({id:req.params.id}, function(err, doc){
                        if(err){
                            res.send({
                                success:false,
                                reason:"DB error."
                            })
                            db.close();
                            return;
                        }
                        if(!doc){
                            res.send({
                                success:false,
                                reason:"Invalid program."
                            })
                            db.close();
                            return;
                        }
                        if(doc.owner === account.id){
                            res.send({
                                success:false,
                                reason:"Views on your own program don't count."
                            })
                            db.close();
                            return;
                        }
                        var updateView = {};

                        if(doc.views.hasOwnProperty(account.id)){
                            if((doc.views[account.id].lastView + ( /* 10 minutes */ 60000*10)) < Date.now()){
                                updateView= {
                                    lastView: Date.now(),
                                    //count:(doc.views[account.id].count + 1)
                                    views: doc.views[account.id].views
                                }
                                updateView.views.push(Date.now())
                            }else{
                                res.send({
                                    success:false,
                                    early:true,
                                    reason:"Too early."
                                })
                                db.close();
                                return;
                            }
                        }else{
                            updateView = {
                                lastView:Date.now(),
                                views:[Date.now()]
                            }
                        }
                        var update = {$set:{}};
                        update["$set"]["views." + account.id] = updateView;
                        programs.findOneAndUpdate({id:req.params.id},update, function(err){
                            if(!err){
                                res.send({
                                    success:true
                                })
                                updateProgramSums(req.params.id);
                            }else{
                                res.send({
                                    success:false,
                                    reason:"Failed to update."
                                })
                            }
                            db.close();
                        });
                        
                    })
                })
                
            }
        })
        
    }else{
        res.send({
            success:false,
            reason:"Invalid session. Please log in again."
        })
    }
});
function updateProgramSums(id){
    mongodb.connect(mongourl, function(err, db){
        var programs = db.collection("programs");
        programs.findOne({id:id}, function(err, doc){
            if(err){db.close(); return;}
            var sumVotes = 1;
            var posVotes = 1;
            var negVotes = 0;
            var sumViews = 0;
            for(var i in doc.votes){
                sumVotes+=doc.votes[i].opinion;
                if(doc.votes[i] > 0){
                    posVotes++;
                }else if(doc.votes[i] < 0) {
                    negVotes++;
                }
            }
            for(var i in doc.views){
                sumViews+=doc.views[i].views.length;
            }
            programs.findOneAndUpdate({id:id},{$set:{sumVotes:sumVotes,positivePercentage:(posVotes/(posVotes+negVotes)),sumViews:sumViews}});
            db.close();
        });
    });
}
mongodb.connect(mongourl, function(err, db){
	if(err){console.log(err);return}
    var programs = db.collection("programs");
    programs.find().toArray(function(err, doc){
        for(var i in doc){
            updateProgramSums(doc[i].id);
        }
        db.close();
    });


});
server.post("/v1/program/:id/vote", function(req, res, next){
    if(!req.headers["csu-session-id"]){
        res.send({
            success:false,
            reason:"User must be authenticated."
        })
        return;
    }
    if(!req.body.hasOwnProperty("vote")){
        res.send({
            success:false,
            reason:"Failed to provide vote"
        })
        return;
    }
    var sessionID = req.headers["csu-session-id"];
    if(isValidSession(sessionID)){
        //console.log(activeSessionIDs[sessionID])
        getAccountByID(activeSessionIDs[sessionID].userid, function(account){
            if(!account){
                res.send({
                    success:false,
                    reason:"Session attached to null user? Contact developer."
                });
            }else{
                mongodb.connect(mongourl, function(err, db){
                    if(err){
                        res.send({
                            success:false,
                            reason:"DB Connection error"
                        })
                        db.close();
                        return;
                    }
                    var programs = db.collection("programs");
                    programs.findOne({id:req.params.id}, function(err, doc){
                        if(err){
                            res.send({
                                success:false,
                                reason:"DB error."
                            })
                            db.close();
                            return;
                        }
                        if(!doc){
                            res.send({
                                success:false,
                                reason:"Invalid program."
                            })
                            db.close();
                            return;
                        }
                        if(doc.owner === account.id){
                            res.send({
                                success:false,
                                reason:"You can't vote on your own program."
                            })
                            db.close();
                            return;
                        }

                        var update = {$set:{}};
                        if(req.body.vote === 0){
                            update = {$unset:{}}
                            update["$unset"]["votes." + account.id] = {
                                updated:Date.now(),
                                opinion:1
                            };
                        }else{
                            update["$set"]["votes." + account.id] = {
                                updated:Date.now(),
                                opinion:Math.max(-1,Math.min(1,req.body.vote))
                            }
                        }
                        programs.findOneAndUpdate({id:req.params.id},update, function(err){
                            if(!err){
                                res.send({
                                    success:true
                                })
                                updateProgramSums(req.params.id);
                            }else{
                                res.send({
                                    success:false,
                                    reason:"Failed to update."
                                })
                            }
                            db.close();
                        });
                        
                    })
                })
                
            }
        })
        
    }else{
        res.send({
            success:false,
            reason:"Invalid session. Please log in again."
        })
    }
});
server.post("/v1/new/program/", function(req, res, next){
    if(!req.headers["csu-session-id"]){
        res.send({
            success:false,
            reason:"User must be authenticated."
        })
        return;
    }
    if(req.body){
        if(!req.body.hasOwnProperty("code") || !req.body.hasOwnProperty("folds") || !req.body.hasOwnProperty("dimensions") || !req.body.hasOwnProperty("name") || !req.body.hasOwnProperty("thumbnail") || !req.body.hasOwnProperty("loopProtect")){
            res.send({
                success:false,
                reason:"Missing data."
            })
            return;
        }
    }
    var sessionID = req.headers["csu-session-id"];
    if(isValidSession(sessionID)){
        //console.log(activeSessionIDs[sessionID])
        getAccountByID(activeSessionIDs[sessionID].userid, function(account){
            if(!account){
                res.send({
                    success:false,
                    reason:"Session attached to null user? Contact developer."
                });

            }else{
                mongodb.connect(mongourl, function(err, db){
                    if(err){
                        res.send({
                            success:false,
                            reason:"DB Connection error"
                        })
                        db.close();
                        return;
                    }
                    generateProgramId(db,function(progid){
                        if(!progid){
                            res.send({
                                success:false,
                                reason:"Program Increment Error"
                            })
                            db.close();
                            return;
                        }
                        var program = {
                            created:Date.now(),
                            name:req.body.name,
                            currentRevision: {
                                code:req.body.code,
                                folds:req.body.folds,
                                dimensions:req.body.dimensions,
                                thumbnail: req.body.thumbnail,
                                loopProtect: req.body.loopProtect,
                                updated:Date.now()
                            },
                            owner:account.id,
                            votes:{},
                            views:{},
                            type:"pjs",
                            revisions:[],
                            tags:[],
                            sumVotes:1,
                            positivePercentage:1,
                            sumViews:0
                        }
                        program.id = progid;
                        var programs = db.collection("programs");
                        programs.insertOne(program,function(err, results){
                            if(err){
                                res.send({
                                    success:false,
                                    reason:"Program Increment Error"
                                })
                            }else{
                                res.send({
                                    success:true,
                                    programID: progid
                                })
                            }
                            db.close();
                        })
                    });
                })
            }
        })
        
    }else{
        res.send({
            success:false,
            reason:"Invalid session. Please log in again."
        })
    }
});
server.put("/v1/user/:type", function(req, res, next){
    if(!req.headers["csu-session-id"]){
        res.send({
            success:false,
            reason:"User must be authenticated."
        })
        return;
    }
    var sessionID = req.headers["csu-session-id"];
    if(isValidSession(sessionID)){
        getAccountByID(activeSessionIDs[sessionID].userid, function(account){
            if(!account){
                res.send({
                    success:false,
                    reason:"Session attached to null user? Contact developer."
                });
            }else{
                mongodb.connect(mongourl,function(err, db){
                    if(err){
                        res.send(500,{
                            success:false,
                            reason:"Internal server error: DB Connection failed."
                        });
                        db.close();
                        return;
                    }
                    switch(req.params.type.toLowerCase()){
                        case "profile":
                            var safeModify = {
                                displayName: account.displayName,
                                username: account.username
                            }
                            if(req.body.hasOwnProperty("username")) safeModify.username = req.body.username;
                            if(req.body.hasOwnProperty("displayName")) safeModify.displayName = req.body.displayName;
                            if(!isAlphaNumeric(safeModify.username)){
                                res.send({
                                    success:false,
                                    reason:"Username must be alphanumeric!"
                                });
                                db.close();
                                return;
                            }
                            if(safeModify.username.length < 3){
                                res.send({
                                    success:false,
                                    reason:"Username must be at least 4 characters."
                                });
                                db.close();
                                return;
                            }
                            if(safeModify.displayName.length < 1){
                                res.send({
                                    success:false,
                                    reason:"Display name must be at least one character."
                                });
                                db.close();
                                return;
                            }
                            var accounts = db.collection("accounts");
                            accounts.find({username:{$regex:'^' + req.body.username + '$', $options: 'i'}}).toArray(function(err, docs){
                                if(safeModify.username.toLowerCase() !== account.username.toLowerCase() && docs.length > 0){
                                    res.send({
                                        success:false,
                                        reason:"Username already in use!"
                                    });
                                    db.close();
                                    return;
                                }
                                accounts.findOneAndUpdate({id:account.id},{$set: safeModify}, function(err, results){
                                    if(!err){
                                        res.send({
                                            success:true,
                                            reason:"User successfully modified."
                                        });
                                    }else{
                                        res.send(500,{
                                            success:false,
                                            reason:"Error updating user profile."
                                        });
                                    }
                                    db.close();
                                })
                            })
                        break;
                        case "editor-settings":
                            var safeModify = {
                                "editor.theme":account.editor.theme
                            }
                            if(req.body.hasOwnProperty("theme")) safeModify["editor.theme"] = req.body.theme;
                            var accounts = db.collection("accounts");
                            accounts.findOneAndUpdate({id:account.id},{$set: safeModify}, function(err, results){
                                if(!err){
                                    res.send({
                                        success:true,
                                        reason:"User successfully modified."
                                    });

                                }else{
                                    res.send(500,{
                                        success:false,
                                        reason:"Error updating user profile."
                                    });
                                }
                                db.close();
                            })
                        break;
                        case "editor-security":
                            var safeModify = {
                                "editor.security.alertLoop":account.editor.security.alertLoop,
                                "editor.security.alertRedirect":account.editor.security.alertRedirect,
                            }
                            if(req.body.hasOwnProperty("alertLoop")) safeModify["editor.security.alertLoop"] = req.body.alertLoop;
                            if(req.body.hasOwnProperty("alertRedirect")) safeModify["editor.security.alertRedirect"] = req.body.alertRedirect;
                            var accounts = db.collection("accounts");
                            accounts.findOneAndUpdate({id:account.id},{$set: safeModify}, function(err, results){
                                if(!err){
                                    res.send({
                                        success:true,
                                        reason:"User successfully modified."
                                    });

                                }else{
                                    res.send(500,{
                                        success:false,
                                        reason:"Error updating user profile."
                                    });
                                }
                                db.close();
                            })
                        break;
                        default:
                            res.send({
                                success:false,
                                reason:"Invalid user update option."
                            });
                            db.close();
                        break;
                    }
                    
                })
                
            }
        })
        
    }else{
        res.send({
            success:false,
            reason:"Invalid session. Please log in again."
        })
    }
});

server.listen(3463, function(e) {
    if(!e){
        console.log("REST API is listening.")
    }
});

/* 
    Express and Handlebars
*/
var express = require("express");
var handlebars = require("express-handlebars");
var session = require("express-session");
var MongoStore = require("connect-mongo")(session);
var sect = require("express-handlebars-sections");
var siteKey = credentials.grecap.siteKey;
var secretKey = credentials.grecap.secretKey;
var recaptcha=new reCAPTCHA({
  siteKey:siteKey,
  secretKey:secretKey
})
var https = require("https");
var http = require("http");
var pwd = require("pwd");
var timeago = require("epoch-timeago").default;

var app = express();

var cors = require("cors")({
	origin:["https://api.csunderground.org","https://sandbox.csunderground.org","https://csunderground.org"]
})
//app.use(ddos.express);
app.engine('handlebars', handlebars({
    defaultLayout: 'main',
    helpers:{
        section: sect(),
        json: function(context) {
            return JSON.stringify(context).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        },
        safeJSON: function(context){
            return JSON.stringify(context).replace(/\"/g,"\\\"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        },
        safeHTML: function(context){
            return context.toString().replace(/\"/g,"'").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        },
        safeJS: function(context){
            return context.toString().replace(/\"/g,"\\\"")
        },
        timeago: function(context){
            return timeago(context)
        },
        plural: function(context){
            if(context === 1){
                return "";
            }else{
                return "s";
            }
        },
        ifCond: function (v1, operator, v2, options) {
            if(parseFloat(v2).toString === v2){
                v2 = parseFloat(v2);
            }
            switch (operator) {
                case '==':
                    return (v1 == v2) ? options.fn(this) : options.inverse(this);
                case '===':
                    return (v1 === v2) ? options.fn(this) : options.inverse(this);
                case '!=':
                    return (v1 != v2) ? options.fn(this) : options.inverse(this);
                case '!==':
                    return (v1 !== v2) ? options.fn(this) : options.inverse(this);
                case '<':
                    return (v1 < v2) ? options.fn(this) : options.inverse(this);
                case '<=':
                    return (v1 <= v2) ? options.fn(this) : options.inverse(this);
                case '>':
                    return (v1 > v2) ? options.fn(this) : options.inverse(this);
                case '>=':
                    return (v1 >= v2) ? options.fn(this) : options.inverse(this);
                case '&&':
                    return (v1 && v2) ? options.fn(this) : options.inverse(this);
                case '||':
                    return (v1 || v2) ? options.fn(this) : options.inverse(this);
                default:
                    return options.inverse(this);
            }
        }
    }
}));
app.set('view engine', 'handlebars');

app.use(session({
    secret: credentials.sessionSecret,
    resave: false,
    rolling: true,
    saveUninitialized: true,
    cookie: {
        secure:false,
        maxAge:(1000*60*60*24)
    },
    store: new MongoStore({url:mongourl})
}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
  extended: true
}));

app.set('trust proxy', 1) 
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    if(req.session.user){
        
        getAccountByID(req.session.user.id, function(user) { 
            res.locals.session = req.session; 
            delete user._id;
            delete user.auth;
            if(user.authLevel){
                if(user.authLevel < 1) delete user.authLevel;
            }
            req.session.user = user;
            res.locals.session.user.sessionID = req.session.id;
        	req.session.touch();
            if(req.session.activeSessionInfo){
                if(req.session.activeSessionInfo.expiration > Date.now()){
                    if(!activeSessionIDs.hasOwnProperty(req.session.id)){
                        activeSessionIDs[req.session.id] = req.session.activeSessionInfo;
                        req.session.activeSessionInfo.expiration = Date.now() + (1000*60*60*24);
                    }
                }
            }
            next();
        });
    }else{
        next();
    }
});
app.get('/', function (req, res) {
    res.render('programlist', {title:"CS Underground"});
});
app.get('/users', function (req, res) {
    res.render('userlist', {title:"Users - CS Underground"});
});
app.get('/guidelines', function(req,res){
    res.render('guidelines',{title:"Community Guidelines - CS Underground"})
})
app.get('/new/program', function (req, res) {
    if(!req.session.user){
        res.redirect("/login");
        return;
    }
    res.render('newprogram', {title:"New Program - CS Underground"});
});
app.get("/program/:id", function(req, res,next){
    getProgram(req.params.id, function(prog,voteVal){
        if(prog){
            delete prog._id;
            if(!prog.owner){
                prog.owner = {
                    username:"Anonymous",
                    displayName:"Anonymous"
                }
            }
            delete prog.currentRevision.thumbnail
            var dat = {
                title:prog.name + " - CS Underground",
                program:prog
            };
            if(voteVal === 1){
                dat.votedUp = true;
            }else if(voteVal === -1){
                dat.votedDown = true;
            }
            res.render('program', dat)
        }else{
            next();
        }
    },((req.session.user)?req.session.user.id:undefined));
    
});
app.get("/profile/:username", function(req, res,next){
    getAccountByUsername(req.params.username,function(account){
        if(!account) return next();
        delete account._id;
        delete account.auth;
        delete account.id;
        res.render('profile',{
            title: account.displayName + " - CS Underground",
            account:account
        })
    })
});
app.get("/profile", function(req, res,next){
    if(!req.session.user){
        res.redirect("/login");
        return;
    }
    var account = JSON.parse(JSON.stringify(req.session.user))
    delete account._id;
    delete account.auth;
    delete account.id;
    res.render('profile',{
        title: account.displayName + " - CS Underground",
        account:account
    })
});
function decodeBase64Image(dataString) {
  var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/),
    response = {};

  if (matches.length !== 3) {
    return new Error('Invalid input string');
  }

  response.type = matches[1];
  response.data = new Buffer(matches[2], 'base64');

  return response;
}

app.get("/program/:id/latest.png", function(req, res,next){
    getProgram(req.params.id, function(prog){
        if(prog){
            if(prog.currentRevision.thumbnail){
                //console.log(prog.currentRevision.thumbnail)
                var img = new Buffer(decodeBase64Image(prog.currentRevision.thumbnail).data, 'base64');

                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': img.length
                });
                res.end(img); 
                delete img;
            }else{
                next();
            }
        }else{
            next();
        }
    });
    
});
var modLevels = {
    USER: 0,
    MODERATOR: 1,
    ADMIN:2
}

var activeSessionIDs = {}; //session id : {userID, expiration}
function isValidSession(sessionID){
    if(activeSessionIDs[sessionID]){
        if(activeSessionIDs[sessionID].expiration > Date.now()){
            return true;
        }else{
            delete activeSessionIDs[sessionID];
            return false;
        }
    }
    return false;
}
function getAccountByID(identifier,callback){
    mongodb.connect(mongourl,function(err, db){
        var accounts = db.collection("accounts");
        accounts.findOne({id:identifier}, function(err, doc){
            if(doc){
                callback(doc);
                db.close();
            }else{
                callback();
                db.close();
            }
        })
    });
}
function getAccountByUsername(username,callback){
    mongodb.connect(mongourl,function(err, db){
        var accounts = db.collection("accounts");
        accounts.findOne({username: { $regex: new RegExp('^'+ username + '$', "i") }}, function(err, doc){
            if(doc){
                callback(doc);
                db.close();
            }else{
                callback();
                db.close();
            }
        })
    });
}
function createUser(username, pass, callback){
    mongodb.connect(mongourl, function(err, db){
        if(err){db.close(); return console.log(err);}
        var accounts = db.collection("accounts");
        /*
            { 
                id: '0000000001',
                username: 'Loki',
                displayName: 'Loki',
                accountCreation: 1502836494324,
                authLevel: 2 
            }
        */
        generateUserId(db,function(id){
            if(!id){db.close(); return console.log("no id!");}
            var account = {
                id: id,
                username:username,
                displayName:username,
                accountCreation:Date.now(),
                authLevel:0,
                editor:{
                    theme:"ace/theme/textmate",
                    security: {
                        "alertLoop":true,
                        "alertRedirect":true
                    }
                }
            };
            pwd.hash(pass, function(err,salt, hash){
                if(err){db.close(); return console.log(err);}
                account.auth = {
                    hash:hash,
                    salt:salt
                }
                accounts.insertOne(account, function(err){
                    if(err) return console.log(err);
                    callback(id)
                    db.close();
                })
            });
        })
        
    });
}
/*createUser("DevTest","genericpassword",function(id){
    console.log("CREATED: id")
})*/
function auth(username,pass, callback){
    getAccountByUsername(username, function(account){
        if(!account){
            callback(new Error("invalid account"))
        }else{
            var authData = account.auth;
            pwd.hash(pass, authData.salt, function(err, hash){
                if(err) return callback(err);
                if(hash.toString() == authData.hash){
                    var cleanUser = account;
                    delete cleanUser._id;
                    delete cleanUser.auth;
                    if(cleanUser.authLevel){
                        if(cleanUser.authLevel < 1) delete cleanUser.authLevel;
                    }
                    //console.log(cleanUser);
                    return callback(null,cleanUser);
                }
                callback(new Error("invalid password"))
            })
        }
    })
    
}
var accountPages = ["profile","settings","security","external"]
app.get("/account", function(req, res){
    if(!req.session.user){
        res.redirect("/login");
        return;
    }
    res.redirect("/account/" + accountPages[0])
})
app.get("/account/:page", function(req, res,next){
	if(!req.secure){
		res.redirect("https://csunderground.org/account/" + req.params.page)
		return 
	}
    if(!req.session.user){
        res.redirect("/login");
        return;
    }
    var data = {
        title:"Account - CS Underground",
        pages:{

        }
    };
    if(accountPages.indexOf(req.params.page.toLowerCase()) == -1){
        res.redirect("/account/" + accountPages[0]);
        return;
    }else{
        data.pages[req.params.page.toLowerCase()] = true;
    }
    res.render("account",data)
})
var editorPages = ["settings","security"]
app.get("/account/editor/:page", function(req, res,next){
	if(!req.secure){
		res.redirect("https://csunderground.org/account/editor/" + req.params.page)
		return 
	}
    if(!req.session.user){
        res.redirect("/login");
        return;
    }
    var data = {
        title:"Editor - CS Underground",
        pages:{

        }
    };
    if(editorPages.indexOf(req.params.page.toLowerCase()) == -1){
        res.redirect("/account/" + editorPages[0]);
        return;
    }else{
        data.pages["editor-"+req.params.page.toLowerCase()] = true;
    }
    res.render("account",data)
})
app.get("/login", function(req,res){
	if(!req.secure){
		res.redirect("https://csunderground.org/login")
		return 
	}
    res.render("login",{
        title:"Login - CS Underground"
    })
});
app.post("/login", function(req, res){
    //console.log(req.body);
    if(!req.secure){
		res.send({
			success:false,
			error:"Insecure"
		})
		return 
	}
    auth(req.body.username,req.body.password, function(err,user){
        if(user) {
            req.session.regenerate(function() {
                req.session.user = user;
                activeSessionIDs[req.session.id] = {
                    userid:user.id,
                    expiration:Date.now() + (1000*60*60*24)
                }
                req.session.activeSessionInfo = activeSessionIDs[req.session.id];
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify({ success:true }));
            });
        }else{
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify({ success: false,error:"Invalid username or password"}));
        }
    })
})

app.get("/resetpassword", function(req,res){
	if(req.session.user){
        res.redirect("/");
        return;
    }
	if(!req.secure){
		res.redirect("https://csunderground.org/resetpassword")
		return 
	}
    res.render("resetpassword",{
        title:"Reset Password - CS Underground"
    })
});
app.post("/resetpassword", function(req, res){
	if(req.session.user){
        res.send({
			success:false,
			error:"You're currently logged in."
		})
        return;
    }
    //console.log(req.body);
    if(!req.secure){
		res.send({
			success:false,
			error:"Insecure"
		})
		return 
	}
	var code = req.body.code;
	var pass = req.body.pass;
    if(codes.hasOwnProperty(code)){
    	if(codes[code].expiry <= Date.now()){
    		delete codes[code];
    		res.send({
	    		success:false,
	    		error:"Invalid recovery code."
	    	})
    	}else{
    		// reset password now.
    		mongodb.connect(mongourl, function(err, db){
                if(err){
                    res.send({
                        success:false,
                        error:"backend db err"
                    });
                    db.close();
                    return;
                }
                var accounts = db.collection("accounts");
                pwd.hash(pass, function(err,salt, hash){
	                if(err){db.close(); return console.log(err);}
	                accounts.findOneAndUpdate({id:codes[code].userid},{$set: {
	                	auth: {
		                    hash:hash,
		                    salt:salt
		                }
	                }}, function(err, results){
	                    if(!err){
	                        res.send({
	                            success:true,
	                            reason:"Password reset."
	                        });
	                    }else{
	                        res.send(500,{
	                            success:false,
	                            reason:"An error occured."
	                        });
	                    }
	                    db.close();
                })
	            });
                
            })
    	}
    }else{
    	res.send({
    		success:false,
    		error:"Invalid recovery code."
    	})
    }
})
var codes = {
	//"code": "userid"
}
function randomString(length){
	var dict = "1234567890ABCDEF".split("");
	var stri = "";
	for(var i = 0; i < length; i++){
		stri+=dict[Math.round(Math.random() * (dict.length-1))];
	}
	if(codes.hasOwnProperty(stri)){
		stri = randomString(length);
	}
	return stri;
}
function generateRecoveryCode() {
	return "CSU:" + randomString(Math.round(Math.random() * 3) + 4) + "-" + randomString(Math.round(Math.random() * 6) + 12);
}
app.get("/genresetcode/:user", function(req, res, next){
	if(!req.session.user){
		next();
		return;
	}
	if(req.session.user.authLevel == 2){
		getAccountByUsername(req.params.user, function(account){
	        if(account){
	            var code = generateRecoveryCode();
	            codes[code] = {
	            	expiry: Date.now() + (((1000 * 60 * 60) * 24) * 14), // 2 weeks.
	            	userid:account.id
	            }
	            res.send(account.id + " --> https://csunderground.org/resetpassword?" + code);

	        }else{
	            res.send(500, "No user.");
	        }
	    })
		return;
	}
	next();
})
setInterval(function() {
	for(var i in codes){
		if(Date.now() > codes[i].expiry){
			delete codes[i];
		}
	}
},1000*60*5);
app.get("/register", function(req,res){
	if(!req.secure){
		res.redirect("https://csunderground.org/login")
		return 
	}
    if(req.session.user){
        res.redirect("/");
        return;
    }
    var recap = recaptcha.formElement();
    res.render("register",{
        title:"Register - CS Underground",
        captcha:recap
    })
});
function isAlphaNumeric(str) {
    return str.replace(/^[a-z0-9]+$/ig,"").length == 0;
}
app.post("/register", function(req,res){
	if(!req.secure){
		res.send({
			success:false,
			error:"Insecure"
		})
		return 
	}

    if(req.session.user){
        res.send({
            success:false,
            error:"You are logged in. Please log out to create an account."
        });
        return;
    }else{
        if(!req.body.hasOwnProperty("recaptcha") || !req.body.hasOwnProperty("username") || !req.body.hasOwnProperty("password") ){
            res.send({
                success:false,
                error:"Not all data provided."
            });
            return;
        }
        if(req.body.username.length < 4){
            res.send({
                success:false,
                error:"Username must be at least 4 characters long."
            });
            return;
        }
        if(req.body.password.length < 9){
            res.send({
                success:false,
                error:"Password must be at least 9 characters."
            });
            return;
        }
        if(!isAlphaNumeric(req.body.username)){
            res.send({
                success:false,
                error:"Username must be alphanumeric!"
            });
            return;
        }
        if(!req.body.recaptcha){
            res.send({
                success:false,
                error:"Please solve the recaptcha."
            });
            return;
        }
        recaptcha.validate(req.body.recaptcha)
            .then(function(){ //SUCCESS
                mongodb.connect(mongourl, function(err, db){
                    if(err){
                        res.send({
                            success:false,
                            error:"backend db err"
                        });
                        db.close();
                        return;
                    }
                    var accounts = db.collection("accounts");
                    accounts.find({username:{$regex:'^' + req.body.username + '$', $options: 'i'}}).toArray(function(err, docs){
                        if(docs.length > 0){
                            res.send({
                                success:false,
                                error:"Username already in use!"
                            });
                            db.close();
                        }else{
                            createUser(req.body.username,req.body.password, function(id){
                                if(!id){
                                    res.send({
                                        success:false,
                                        error:"Failure to create user!"
                                    });
                                    db.close();
                                }
                                auth(req.body.username,req.body.password, function(err,user){
                                    if(user) {
                                        req.session.regenerate(function() {
                                            req.session.user = user;
                                            activeSessionIDs[req.session.id] = {
                                                userid:user.id,
                                                expiration:Date.now() + (1000*60*60*24)
                                            }
                                            res.send({
                                                success:true,
                                                userid:id
                                            });
                                            db.close();
                                        });
                                    }else{
                                        res.send({
                                            success:false,
                                            error:"Failure to create user!"
                                        });
                                        db.close();
                                    }
                                })
                            })
                            
                        }
                    })
                })
                
            })
            .catch(function(errorCodes){
                console.log(errorCodes)
                res.send({
                    success:false,
                    error:"ReCaptcha error occured. Please try again."
                });
            });
            
        
    }
    
});
app.get("/logout",function(req,res){
	if(!req.session.user){
		res.redirect("/login");
		return;
	}
    req.session.destroy(function() {
        res.redirect("/");
    })
})
app.use(express.static('public'))
app.use(function(req, res, next){
	res.status(404);
	res.render("404",{title:"404 - CSUnderground"})
})
var srv = https.createServer(httpsCerts,app);
srv.listen(credentials.httpsPort);
var srvHTTP = http.createServer(app);
srvHTTP.listen(credentials.httpPort);
console.log("Express is listening.")
