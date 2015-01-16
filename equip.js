function Equip (table, id) {
	var template = table.equip[id];
	if (!template) {
		throw new Error('equip_not_exist_err');
	}
	for (var key in template) {
		var val = template[key];
		if (val) {
			this[key] = val;
		} else {
			this[key] = Math.floor(Math.random() * 100);	//TODO: real formula
		}
	}
}

module.exports = Equip;
