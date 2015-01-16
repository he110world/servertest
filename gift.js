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
				throw new Error('invalid_gift_err');
			}
		}
	}
}

module.exports = Gift;
