const babelParsers = require("prettier/parser-babel").parsers;

const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const types = require("@babel/types");

class Strategy {
  constructor() {
    this.strategy_map = {};
    this.cacheObject = {
      none: [],
      all: [],
      multiple: [],
      single: [],
      else: [],
    };
  }
  Registrator(ruleName, ruleFun, callback) {
    if (ruleName in this.strategy_map) {
      console.log(this.strategy_map[ruleName]);
      return false;
    }
    this.strategy_map[ruleName] = { fun: ruleFun, callback };
  }
  Exec(node) {
    let flag = false;
    for (const key in this.strategy_map) {
      if (this.strategy_map[key].fun(node)) {
        this.strategy_map[key].callback(node);
        flag = true;
      }
    }
    if (!flag) {
      return [true, 1];
    } else {
      return [false, 0];
    }
  }
}

const sort_base = (a, b) => {
  return getFileName(a) > getFileName(b)
    ? 1
    : getFileName(b) > getFileName(a)
    ? -1
    : 0;
};

const sort_part = (a, b) => {
  return getPartName(a) > getPartName(b)
    ? 1
    : getPartName(b) > getPartName(a)
    ? -1
    : 0;
};

const sort_singleName = (a, b) => {
  return getSingleName(a) > getSingleName(b)
    ? 1
    : getSingleName(b) > getSingleName(a)
    ? -1
    : 0;
};

// 获取文件名
const getFileName = (node) => {
  return node.source.rawValue;
};

// 获取导入部分对象的部分名称
const getPartName = (specifier) => {
  return specifier.imported.name;
};

// 单一导入 导入对象名称
const getSingleName = (specifier) => {
  return specifier.local.name;
};

// 部分导入内容排序
const sort_multiple_part = (SpecifiersList = []) => {
  let t = SpecifiersList.sort((a, b) => {
    return getPartName(a) > getPartName(b)
      ? 1
      : getPartName(b) > getPartName(a)
      ? -1
      : 0;
  });
  return t;
};

// 对没有导入对象的文件进行排序
const sort_none = (currentNode, NodeList = []) => {
  if (NodeList.length === 0) return [currentNode];
  NodeList.push(currentNode);
  return NodeList.sort((a, b) => {
    return sort_base(a, b);
  });
};

// 对导入所有的对象文件进行排序
const sort_all = (currentNode, NodeList = []) => {
  if (NodeList.length === 0) return [currentNode];
  NodeList.push(currentNode);
  return NodeList.sort((a, b) => {
    return sort_base(a, b);
  });
};

// 对部分导入的文件进行排序
const sort_multiple = (currentNode, NodeList = []) => {
  // 1. 先对 currentNode 里的 specifiers 排序
  currentNode.specifiers = sort_multiple_part(currentNode.specifiers);
  if (NodeList.length === 0) return [currentNode];
  // 2. 插入后对文件名称进行排序
  NodeList.push(currentNode);
  return NodeList.sort((a, b) => {
    if (a.specifiers.length - b.specifiers.length > 0) {
      return -1;
    } else if (a.specifiers.length - b.specifiers.length < 0) {
      return 1;
    } else {
      return (
        a.specifiers.length === b.specifiers.length &&
        sort_part(a.specifiers[0], b.specifiers[0])
      );
    }
  });
};

// 对单一导出的文件进行排序
const sort_single = (currentNode, NodeList = []) => {
  if (NodeList.length === 0) return [currentNode];
  NodeList.push(currentNode);
  return NodeList.sort((a, b) => {
    return sort_singleName(a.specifiers[0], b.specifiers[0]);
  });
};

const judge_all = (currentNode) => {
  return (
    5 + currentNode.local.name.length === currentNode.end - currentNode.start
  );
};

const judge_multiple = (currentNode) => {
  let FLAG = true;
  const { specifiers } = currentNode;
  for (let index = 0; index < specifiers.length; index++) {
    if (specifiers[index]["type"] !== "ImportSpecifier") {
      FLAG = false;
      break;
    }
  }
  return FLAG;
};

function sortsImportSiroi(code, options) {
  const ast = parser.parse(code, {
    plugins: ["js", "jsx"],
    sourceType: "module",
  });

  // 获取所有的 import 语句
  const importNodes = [];

  traverse(ast, {
    ImportDeclaration(path) {
      importNodes.push(path.node);
      path.remove();
    },
  });

  let strategy = new Strategy();

  strategy.Registrator(
    "none",
    (Node) => Node.specifiers.length === 0,
    (Node) => {
      strategy.cacheObject["none"] = sort_none(
        Node,
        strategy.cacheObject["none"]
      );
    }
  );

  strategy.Registrator(
    "multiple",
    (Node) => judge_multiple(Node) && Node.specifiers.length > 1,
    (Node) => {
      strategy.cacheObject["multiple"] = sort_multiple(
        Node,
        strategy.cacheObject["multiple"]
      );
    }
  );

  strategy.Registrator(
    "all",
    (Node) => Node.specifiers.length === 1 && judge_all(Node.specifiers[0]),
    (Node) => {
      strategy.cacheObject["all"] = sort_all(Node, strategy.cacheObject["all"]);
    }
  );

  strategy.Registrator(
    "single",
    (Node) => {
      return (
        Node.specifiers.length === 1 &&
        (judge_multiple(Node) || !judge_all(Node.specifiers[0]))
      );
    },
    (Node) =>
      (strategy.cacheObject["single"] = sort_single(
        Node,
        strategy.cacheObject["single"]
      ))
  );

  importNodes.forEach((Node) => {
    let [err, _] = strategy.Exec(Node);
    if (err) strategy.cacheObject["else"].push(Node);
  });

  const newImports = [
    ...strategy.cacheObject["none"],
    ...strategy.cacheObject["all"],
    ...strategy.cacheObject["multiple"],
    ...strategy.cacheObject["single"],
    ...strategy.cacheObject["else"],
  ];

  if (newImports.length === 0) {
    throw new Error("import 0 ");
  }

  const newAST = types.file({
    type: "Program",
    body: newImports,
  });

  const newCode =
    generate(newAST).code +
    "\n" +
    generate(ast, {
      retainLines: true,
    }).code;

  return newCode;
}

module.exports = {
  parsers: {
    babel: {
      ...babelParsers.babel,
      preprocess: sortsImportSiroi,
    },
  },
};
