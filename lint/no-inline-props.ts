interface Node {
  type: string;
  range: [number, number];
  [key: string]: any;
}

interface Context {
  report: (diagnostic: { node: Node; message: string }) => void;
}

const COMPONENT = /^[A-Z]/;

function inlineProps(fn: Node | undefined) {
  const param = fn?.params?.[0];
  if (!param) return null;
  const target = param.type === "AssignmentPattern" ? param.left : param;
  const type = target.typeAnnotation?.typeAnnotation;
  if (!type) return null;
  if (type.type === "TSTypeLiteral") return type;
  if (
    type.type === "TSIntersectionType" &&
    type.types.some((part: Node) => part.type === "TSTypeLiteral")
  ) {
    return type;
  }
  return null;
}

export const noInlineProps = {
  meta: {
    type: "suggestion" as const,
    docs: {
      description:
        "Requires a component's props to be a named interface instead of an inline object type",
    },
  },
  create(context: Context) {
    const check = (name: string | undefined, fn: Node | undefined) => {
      if (!name || !COMPONENT.test(name)) return;
      const type = inlineProps(fn);
      if (!type) return;
      context.report({
        node: type,
        message: `Declare the props as \`interface ${name}Props\` above the component.`,
      });
    };
    return {
      FunctionDeclaration(node: Node) {
        check(node.id?.name, node);
      },
      VariableDeclarator(node: Node) {
        const init = node.init;
        if (
          init?.type !== "ArrowFunctionExpression" &&
          init?.type !== "FunctionExpression"
        ) {
          return;
        }
        check(node.id?.name, init);
      },
    };
  },
};
