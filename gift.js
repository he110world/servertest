function Gift(id) {
	this.ID = id;
	this.Time = Date.now();
}

Gift.prototype.use = function (table, cb) {
	var gift = table.gift[this.ID];
	var id = gift.ItemID;
	var num = gift.ItemNum;
	var item = table.item[id];
	if (item) {
		cb('item', id, num);
	} else {
		var equip = table.equip[id];
		if (equip) {
			cb('equip', id, num);
		} else {
			var girl = table.girl[id];
			if (girl) {
				cb('girl', id, num);
			} else {
				cb(null, id, num);
//				throw new Error('invalid_gift_err');
			}
		}
	}
}

Gift.prototype.usesync = function (table) {
	var gift = table.gift[this.ID];
	var id = gift.ItemID;
	var num = gift.ItemNum;
	var item = table.item[id];
	var res = {};
	if (item) {
		res.type = 'item';
		res.id = id;
		res.num = num;
	} else {
		var equip = table.equip[id];
		if (equip) {
			res.type = 'equip';
			res.id = id;
			res.num = num;
		} else {
			var girl = table.girl[id];
			if (girl) {
				res.type = 'girl';
				res.id = id;
				res.num = num;
			} else {
				res.type = 'invalid';
			}
		}
	}
	return res;
}

module.exports = Gift;
