// Loads the browser MiniC files into Node (they attach to global.MiniC).
require('../web/js/minic/pp.js');
require('../web/js/minic/parse.js');
require('../web/js/minic/vm.js');
module.exports = global.MiniC;
