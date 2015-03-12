/*
 * KPI Archive
 * 
 * will be executed once per day: check if data already exists to avoid multiple executions
 * will compute yesterday's statistics
 * computed data will be stored in yesterday's collection
 * if there's no yesterday's data, we shall pass
 */
var vip = require('./vip');
var moment = require('moment');
var mongo = require('mongodb').MongoClient;
var mongourl = process.argv[2];
if (!mongourl) {
	mongourl = 'mongodb://localhost:27017';
}

var db, arch;
var yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');
var beforeyesterday = moment().subtract(2, 'days').format('YYYY-MM-DD');
var _31daysago = moment().subtract(31, 'days').format('YYYY-MM-DD');
var yesterdayUsers = {};
var yesterdayUids = [];

function calcDailyVIP () {
	var cnt = {};
	for (var i=0; i<5; i++) {
		cnt[i] = 0;
	}

	for (var uid in yesterdayUsers) {
		var user = yesterdayUsers[uid];
		var v = !user.pay ? 0 : vip.daily(user.pay);
		++cnt[v];
	}

	arch.update({name:'dvip'}, cnt, {upsert:true}, function(err,result){
		if (err) {
			console.log(err);
		}
	});
}

function calcVIP () {
	var cnt = {};
	for (var i=0; i<5; i++) {
		cnt[i] = 0;
	}

	var pays = {};
	db.collection('payment').find({uid:{$in:yesterdayUids}}).toArray(function(err, payments){
		for (var i in payments) {
			var pay = payments[i];
			pays[pay.uid] = pay.total;
		}
		for (var i in yesterdayUids) {
			var uid = yesterdayUids[i];
			var pay = pays[uid];
			var v = !pay ? 0 : vip.total(pay);
			++cnt[v];
		}

		arch.update({name:'vip'}, cnt, {upsert:true});
	});
}

function calcFQ () {
	db.collection(beforeyesterday+':FQ').find({uid:{$in:yesterdayUids}}).toArray(function(err, fqs){
		var fqcollection = db.collection(yesterday+':FQ');
		var retention = {};
		for (var i in fqs) {
			var fq = fqs[i];
			var newFQ = fq.FQ + 1;
			if (newFQ > 30) {
				newFQ = 30;
			}
			retention[fq.uid] = true;
			fqcollection.update({uid:fq.uid}, {uid:fq.uid, FQ:newFQ}, {upsert:true});
		}

		for (var i in yesterdayUids) {
			var uid = yesterdayUids[i];
			if (!retention[uid]) {
				fqcollection.update({uid:uid}, {uid:uid, FQ:1}, {upsert:true});
			}
		}
	});
}

function calcNFQ () {
	db.collection('NFQ', function(err, nfqcollection){
		// dec nfq 31 days ago
		db.collection(_31daysago).find({}, {uid:1}).toArray(function(err, oldusers){
			var olduids = [];
			for (var i in oldusers) {
				olduids.push(oldusers[i].uid);
			}
			nfqcollection.update({uid:{$in:olduids}}, {$inc:{NFQ:-1}}, {multi:true}, function(err, result){
				nfqcollection.remove({NFQ:{$lt:1}}, function(err, result){
					nfqcollection.find({uid:{$in:yesterdayUids}}).toArray(function(err, nfqdocs){
						var nfqs = {};
						for (var i in nfqdocs) {
							var nfq = nfqdocs[i];
							nfqs[nfq.uid] = nfq;
						}

						var yescollection = db.collection(yesterday+':NFQ');
						for (var i in yesterdayUids) {
							var uid = yesterdayUids[i];
							var nfq = nfqs[uid];
							var newNFQ;
							if (nfq) {
								newNFQ = nfq.NFQ + 1;
								if (newNFQ > 30) {
									newNFQ = 30;
								} 
							} else {
								newNFQ = 1;
							}

							nfqcollection.update({uid:uid}, {uid:uid, NFQ:newNFQ}, {upsert:true});
							yescollection.update({uid:uid}, {uid:uid, NFQ:newNFQ}, {upsert:true});
						}
					});
				});
			});
		});
	})
}

function calcRetention () {
}

function calcMap () {
}

mongo.connect(mongourl + '/kpi', function(err, kpidb) {
	if (err) {
		console.log('db err');
		return;
	}

	db = kpidb;
	var name = yesterday + ':arch';
	db.listCollections({name:name}).toArray(function(err, docs){
		if (docs.length > 0) {	// already exist
			process.exit();
		}

		// fetch yesterday's user info
		db.collection(yesterday).find({}).toArray(function(err, docs){
			for (var i in docs) {
				var doc = docs[i];
				yesterdayUsers[doc.uid] = doc;
				yesterdayUids.push(doc.uid);
			}

			// calc kpi
			arch = db.collection(name);
			calcDailyVIP();
			calcVIP();
			calcFQ();
			calcNFQ();
			calcRetention();
			calcMap();
		});
	});

});
