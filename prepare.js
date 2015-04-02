var redis = require('redis');
var db = redis.createClient();
var Const = require('./const');

// create room id generator
function initRoomIdGenerator (cb) {
	db.exists('roomfree', function(err,exists){
		if (exists) {
			cb();
		} else {
			// create ID 1 - MAX_ROOMS
			var ids = [];
			for (var i=1; i<=Const.MAX_ROOMS; i++) {
				ids.push(i);
			}
			db.sadd('roomfree', ids, function(err,cnt){
				console.log(cnt + ' room id added.');
				cb();
			});
		}
	});
}

initRoomIdGenerator (function(){
	console.log('All done.');
});
