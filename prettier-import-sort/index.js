const babelParsers = require("prettier/parser-babel").parsers;

const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const types = require("@babel/types");

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

function myPreprocessor(code, options) {
  const ast = parser.parse(code, {
    plugins: ["js", "jsx"],
    sourceType: "module",
  });

  // 获取所有的 import 语句
  const importNodes = [];

  const cacheObject = {
    none: [],
    all: [],
    multiple: [],
    single: [],
    else: [],
  };

  traverse(ast, {
    ImportDeclaration(path) {
      importNodes.push(path.node);
      path.remove();
    },
  });

  importNodes.forEach((Node) => {
    if (Node.specifiers.length === 0) {
      cacheObject["none"] = sort_none(Node, cacheObject["none"]);
    } else if (judge_multiple(Node)) {
      if (Node.specifiers.length === 1) {
        cacheObject["single"] = sort_single(Node, cacheObject["single"]);
      } else {
        cacheObject["multiple"] = sort_multiple(Node, cacheObject["multiple"]);
      }
    } else if (Node.specifiers.length === 1) {
      if (judge_all(Node.specifiers[0])) {
        cacheObject["all"] = sort_all(Node, cacheObject["all"]);
      } else {
        cacheObject["single"] = sort_single(Node, cacheObject["single"]);
      }
    } else {
      cacheObject["else"].push(Node);
    }
  });

  const newImports = [
    ...cacheObject["none"],
    ...cacheObject["all"],
    ...cacheObject["multiple"],
    ...cacheObject["single"],
    ...cacheObject["else"],
  ];

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
      preprocess: myPreprocessor,
    },
  },
};
