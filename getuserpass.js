var redis=require('redis');
var db=redis.createClient();
var uid=process.argv[2];

db.keys('account:*:id', function(err,accounts){
	accounts.forEach(function(account, i){
		var user = account.split(':')[1];
		db.get('account:'+user+':id', function(err,id){
			if (id == uid) {
				db.get('user:' + user, function(err,pass){
					console.log(user,pass);
				});
			}
		});
	});
});
