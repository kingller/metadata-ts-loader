import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// import { buildFilter } from './buildFilter';

// We'll use the currentDirectoryName to trim parent fileNames
const currentDirectoryPath = process.cwd();
const currentDirectoryParts = currentDirectoryPath.split(path.sep);
const currentDirectoryName =
  currentDirectoryParts[currentDirectoryParts.length - 1];
export interface StringIndexedObject<T> {
  [key: string]: T;
}

export interface ComponentDoc {
  displayName: string;
  description: string;
  props: Props;
  methods: Method[];
}

export interface Props extends StringIndexedObject<PropItem> {}

export interface PropItem {
  name: string;
  required: boolean;
  type: PropItemType;
  description: string;
  defaultValue: any;
  parent?: ParentType;
}

export interface Method {
  name: string;
  docblock: string;
  modifiers: string[];
  params: Array<MethodParameter>;
  returns?: {
    description?: string | null;
    type?: string;
  } | null;
  description: string;
}

export interface MethodParameter {
  name: string;
  description?: string | null;
  type: MethodParameterType;
}

export interface MethodParameterType {
  name: string;
}

export interface Component {
  name: string;
}

export interface PropItemType {
  name: string;
  value?: any;
  raw?: string;
}

export interface ParentType {
  name: string;
  fileName: string;
}

export type ComponentNameResolver = (
  exp: ts.Symbol,
  source: ts.SourceFile
) => string | undefined | null | false;

export interface ParserOptions {
  componentNameResolver?: ComponentNameResolver;
  shouldExtractLiteralValuesFromEnum?: boolean;
}

export const defaultParserOpts: ParserOptions = {};

export interface FileParser {
  parse(filePathOrPaths: string | string[]): ComponentDoc[];
  parseWithProgramProvider(
    filePathOrPaths: string | string[],
    programProvider?: () => ts.Program
  ): ComponentDoc[];
}

const defaultOptions: ts.CompilerOptions = {
  jsx: ts.JsxEmit.React,
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.Latest
};

/**
 * Parses a file with default TS options
 * @param filePath component file that should be parsed
 */
export function parse(
  filePathOrPaths: string | string[],
  parserOpts: ParserOptions = defaultParserOpts
) {
  return withCompilerOptions(defaultOptions, parserOpts).parse(filePathOrPaths);
}

/**
 * Constructs a parser for a default configuration.
 */
export function withDefaultConfig(
  parserOpts: ParserOptions = defaultParserOpts
): FileParser {
  return withCompilerOptions(defaultOptions, parserOpts);
}

/**
 * Constructs a parser for a specified tsconfig file.
 */
export function withCustomConfig(
  tsconfigPath: string,
  parserOpts: ParserOptions
): FileParser {
  const basePath = path.dirname(tsconfigPath);
  const { config, error } = ts.readConfigFile(tsconfigPath, filename =>
    fs.readFileSync(filename, 'utf8')
  );

  if (error !== undefined) {
    const errorText = `Cannot load custom tsconfig.json from provided path: ${tsconfigPath}, with error code: ${error.code}, message: ${error.messageText}`;
    throw new Error(errorText);
  }

  const { options, errors } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    basePath,
    {},
    tsconfigPath
  );

  if (errors && errors.length) {
    throw errors[0];
  }

  return withCompilerOptions(options, parserOpts);
}

/**
 * Constructs a parser for a specified set of TS compiler options.
 */
export function withCompilerOptions(
  compilerOptions: ts.CompilerOptions,
  parserOpts: ParserOptions = defaultParserOpts
): FileParser {
  return {
    parse(filePathOrPaths: string | string[]): ComponentDoc[] {
      return parseWithProgramProvider(
        filePathOrPaths,
        compilerOptions,
        parserOpts
      );
    },
    parseWithProgramProvider(filePathOrPaths, programProvider) {
      return parseWithProgramProvider(
        filePathOrPaths,
        compilerOptions,
        parserOpts,
        programProvider
      );
    }
  };
}

interface JSDoc {
  description: string;
  fullComment: string;
  tags: StringIndexedObject<string>;
}

const defaultJSDoc: JSDoc = {
  description: '',
  fullComment: '',
  tags: {}
};

export class Parser {
  private checker: ts.TypeChecker;
  private shouldExtractLiteralValuesFromEnum: boolean;

  constructor(program: ts.Program, opts: ParserOptions) {
    this.checker = program.getTypeChecker();
    this.shouldExtractLiteralValuesFromEnum = Boolean(
      opts.shouldExtractLiteralValuesFromEnum
    );
  }

  public getInterfaceInfo(
    exp: ts.Symbol,
    source: ts.SourceFile,
    componentNameResolver: ComponentNameResolver = () => undefined
  ): ComponentDoc | null {
    if (!!exp.declarations && exp.declarations.length === 0) {
      return null;
    }

    const type = this.checker.getTypeOfSymbolAtLocation(
      exp,
      exp.valueDeclaration || exp.declarations![0]
    );
    let commentSource = exp;
    const propsType = exp.members;

    const resolvedComponentName = componentNameResolver(exp, source);
    const displayName =
      resolvedComponentName || computeComponentName(exp, source);
    const description = this.findDocComment(commentSource).fullComment;
    const methods = this.getMethodsInfo(type);

    if (propsType) {
      const props = this.getPropsInfo(propsType);

      return {
        description,
        displayName,
        methods,
        props
      };
    } else if (description && displayName) {
      return {
        description,
        displayName,
        methods,
        props: {}
      };
    }

    return null;
  }

  public extractMembersFromType(type: ts.Type): ts.Symbol[] {
    const methodSymbols: ts.Symbol[] = [];

    /**
     * Need to loop over properties first so we capture any
     * static methods. static methods aren't captured in type.symbol.members
     */
    type.getProperties().forEach(property => {
      // Only add members, don't add non-member properties
      if (this.getCallSignature(property)) {
        methodSymbols.push(property);
      }
    });

    if (type.symbol && type.symbol.members) {
      type.symbol.members.forEach(member => {
        methodSymbols.push(member);
      });
    }

    return methodSymbols;
  }

  public getMethodsInfo(type: ts.Type): Method[] {
    const members = this.extractMembersFromType(type);
    const methods: Method[] = [];
    members.forEach(member => {
      if (!this.isTaggedPublic(member)) {
        return;
      }

      const name = member.getName();
      const docblock = this.getFullJsDocComment(member).fullComment;
      const callSignature = this.getCallSignature(member);
      const params = this.getParameterInfo(callSignature);
      const description = ts.displayPartsToString(
        member.getDocumentationComment(this.checker)
      );
      const returnType = this.checker.typeToString(
        callSignature.getReturnType()
      );
      const returnDescription = this.getReturnDescription(member);
      const modifiers = this.getModifiers(member);

      methods.push({
        description,
        docblock,
        modifiers,
        name,
        params,
        returns: returnDescription
          ? {
              description: returnDescription,
              type: returnType
            }
          : null
      });
    });

    return methods;
  }

  public getModifiers(member: ts.Symbol) {
    const modifiers: string[] = [];
    const flags = ts.getCombinedModifierFlags(member.valueDeclaration);
    const isStatic = (flags & ts.ModifierFlags.Static) !== 0; // tslint:disable-line no-bitwise

    if (isStatic) {
      modifiers.push('static');
    }

    return modifiers;
  }

  public getParameterInfo(callSignature: ts.Signature): Array<MethodParameter> {
    return callSignature.parameters.map(param => {
      const paramType = this.checker.getTypeOfSymbolAtLocation(
        param,
        param.valueDeclaration
      );
      const paramDeclaration = this.checker.symbolToParameterDeclaration(param);
      const isOptionalParam: boolean = !!(
        paramDeclaration && paramDeclaration.questionToken
      );

      return {
        description:
          ts.displayPartsToString(
            param.getDocumentationComment(this.checker)
          ) || null,
        name: param.getName() + (isOptionalParam ? '?' : ''),
        type: { name: this.checker.typeToString(paramType) }
      };
    });
  }

  public getCallSignature(symbol: ts.Symbol) {
    const symbolType = this.checker.getTypeOfSymbolAtLocation(
      symbol,
      symbol.valueDeclaration!
    );

    return symbolType.getCallSignatures()[0];
  }

  public isTaggedPublic(symbol: ts.Symbol) {
    const jsDocTags = symbol.getJsDocTags();
    const isPublic = Boolean(jsDocTags.find(tag => tag.name === 'public'));
    return isPublic;
  }

  public getReturnDescription(symbol: ts.Symbol) {
    const tags = symbol.getJsDocTags();
    const returnTag = tags.find(tag => tag.name === 'returns');
    if (!returnTag) {
      return null;
    }

    return returnTag.text || null;
  }

  public getDocgenType(propType: ts.Type): PropItemType {
    const propTypeString = this.checker.typeToString(propType);

    if (
      this.shouldExtractLiteralValuesFromEnum &&
      propType.isUnion() &&
      propType.types.every(type => type.isStringLiteral())
    ) {
      return {
        name: 'enum',
        raw: propTypeString,
        value: propType.types
          .map(type => ({
            value: type.isStringLiteral() ? `"${type.value}"` : undefined
          }))
          .filter(Boolean)
      };
    }

    return { name: propTypeString };
  }

  public getPropsInfo(
    propsMap: ts.UnderscoreEscapedMap<ts.Symbol>,
    defaultProps: StringIndexedObject<string> = {}
  ): Props {
    if (!propsMap) {
      return {};
    }
    const result: Props = {};
    propsMap.forEach((propsObj, propName) => {
      // Find type of prop by looking in context of the props object itself.
      const propType = this.checker.getTypeOfSymbolAtLocation(
        propsObj,
        propsObj.valueDeclaration!
      );

      // tslint:disable-next-line:no-bitwise
      const isOptional = (propsObj.getFlags() & ts.SymbolFlags.Optional) !== 0;

      const jsDocComment = this.findDocComment(propsObj);
      const hasCodeBasedDefault = defaultProps[propName as string] !== undefined;

      let defaultValue = null;

      if (hasCodeBasedDefault) {
        defaultValue = { value: defaultProps[propName as string] };
      } else if (jsDocComment.tags.default) {
        defaultValue = { value: jsDocComment.tags.default };
      }

      const parent = getParentType(propsObj);

      result[propName as string] = {
        defaultValue,
        description: jsDocComment.fullComment,
        name: propName as string,
        parent,
        required: !isOptional && !hasCodeBasedDefault,
        type: this.getDocgenType(propType)
      };
    });

    return result;
  }

  public findDocComment(symbol: ts.Symbol): JSDoc {
    const comment = this.getFullJsDocComment(symbol);
    if (comment.fullComment) {
      return comment;
    }

    const rootSymbols = this.checker.getRootSymbols(symbol);
    const commentsOnRootSymbols = rootSymbols
      .filter(x => x !== symbol)
      .map(x => this.getFullJsDocComment(x))
      .filter(x => !!x.fullComment);

    if (commentsOnRootSymbols.length) {
      return commentsOnRootSymbols[0];
    }

    return defaultJSDoc;
  }

  /**
   * Extracts a full JsDoc comment from a symbol, even
   * though TypeScript has broken down the JsDoc comment into plain
   * text and JsDoc tags.
   */
  public getFullJsDocComment(symbol: ts.Symbol): JSDoc {
    // in some cases this can be undefined (Pick<Type, 'prop1'|'prop2'>)
    if (symbol.getDocumentationComment === undefined) {
      return defaultJSDoc;
    }

    let mainComment = ts.displayPartsToString(
      symbol.getDocumentationComment(this.checker)
    );

    if (mainComment) {
      mainComment = mainComment.replace('\r\n', '\n');
    }

    const tags = symbol.getJsDocTags() || [];

    const tagComments: string[] = [];
    const tagMap: StringIndexedObject<string> = {};

    tags.forEach(tag => {
      const trimmedText = (tag.text || '').trim();
      const currentValue = tagMap[tag.name];
      tagMap[tag.name] = currentValue
        ? currentValue + '\n' + trimmedText
        : trimmedText;

      if (tag.name !== 'default') {
        tagComments.push(formatTag(tag));
      }
    });

    return {
      description: mainComment,
      fullComment: (mainComment + '\n' + tagComments.join('\n')).trim(),
      tags: tagMap
    };
  }
}

function formatTag(tag: ts.JSDocTagInfo) {
  let result = '@' + tag.name;
  if (tag.text) {
    result += ' ' + tag.text;
  }
  return result;
}

function getTextValueOfClassMember(
  classDeclaration: ts.ClassDeclaration,
  memberName: string
): string {
  const [textValue] = classDeclaration.members
    .filter(member => ts.isPropertyDeclaration(member))
    .filter(member => {
      const name = ts.getNameOfDeclaration(member) as ts.Identifier;
      return name && name.text === memberName;
    })
    .map(member => {
      const property = member as ts.PropertyDeclaration;
      return (
        property.initializer && (property.initializer as ts.Identifier).text
      );
    });

  return textValue || '';
}

function getTextValueOfFunctionProperty(
  exp: ts.Symbol,
  source: ts.SourceFile,
  propertyName: string
) {
  const [textValue] = source.statements
    .filter(statement => ts.isExpressionStatement(statement))
    .filter(statement => {
      const expr = (statement as ts.ExpressionStatement)
        .expression as ts.BinaryExpression;
      return (
        expr.left &&
        (expr.left as ts.PropertyAccessExpression).name &&
        (expr.left as ts.PropertyAccessExpression).name.escapedText ===
          propertyName
      );
    })
    .filter(statement => {
      const expr = (statement as ts.ExpressionStatement)
        .expression as ts.BinaryExpression;

      return (
        ((expr.left as ts.PropertyAccessExpression).expression as ts.Identifier)
          .escapedText === exp.getName()
      );
    })
    .filter(statement => {
      return ts.isStringLiteral(
        ((statement as ts.ExpressionStatement)
          .expression as ts.BinaryExpression).right
      );
    })
    .map(statement => {
      return (((statement as ts.ExpressionStatement)
        .expression as ts.BinaryExpression).right as ts.Identifier).text;
    });

  return textValue || '';
}

function computeComponentName(exp: ts.Symbol, source: ts.SourceFile) {
  const exportName = exp.getName();

  const statelessDisplayName = getTextValueOfFunctionProperty(
    exp,
    source,
    'displayName'
  );

  const statefulDisplayName =
    exp.valueDeclaration &&
    ts.isClassDeclaration(exp.valueDeclaration) &&
    getTextValueOfClassMember(exp.valueDeclaration, 'displayName');

  if (statelessDisplayName || statefulDisplayName) {
    return statelessDisplayName || statefulDisplayName || '';
  }

  if (
    exportName === 'default' ||
    exportName === '__function' ||
    exportName === 'Stateless' ||
    exportName === 'StyledComponentClass' ||
    exportName === 'StyledComponent' ||
    exportName === 'FunctionComponent' ||
    exportName === 'StatelessComponent'
  ) {
    return getDefaultExportForFile(source);
  } else {
    return exportName;
  }
}

// Default export for a file: named after file
export function getDefaultExportForFile(source: ts.SourceFile) {
  const name = path.basename(source.fileName, path.extname(source.fileName));
  const filename =
    name === 'index' ? path.basename(path.dirname(source.fileName)) : name;

  // JS identifiers must starts with a letter, and contain letters and/or numbers
  // So, you could not take filename as is
  const identifier = filename
    .replace(/^[^A-Z]*/gi, '')
    .replace(/[^A-Z0-9]*/gi, '');

  return identifier.length ? identifier : 'DefaultName';
}

function getParentType(prop: ts.Symbol): ParentType | undefined {
  const declarations = prop.getDeclarations();

  if (declarations == null || declarations.length === 0) {
    return undefined;
  }

  // Props can be declared only in one place
  const { parent } = declarations[0];

  if (!isInterfaceOrTypeAliasDeclaration(parent)) {
    return undefined;
  }

  const parentName = parent.name.text;
  const { fileName } = parent.getSourceFile();

  const fileNameParts = fileName.split(path.sep);
  const trimmedFileNameParts = fileNameParts.slice();

  while (trimmedFileNameParts.length) {
    if (trimmedFileNameParts[0] === currentDirectoryName) {
      break;
    }
    trimmedFileNameParts.splice(0, 1);
  }
  let trimmedFileName;
  if (trimmedFileNameParts.length) {
    trimmedFileName = trimmedFileNameParts.join(path.sep);
  } else {
    trimmedFileName = fileName;
  }

  return {
    fileName: trimmedFileName,
    name: parentName
  };
}

function isInterfaceOrTypeAliasDeclaration(
  node: ts.Node
): node is ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
  return (
    node.kind === ts.SyntaxKind.InterfaceDeclaration ||
    node.kind === ts.SyntaxKind.TypeAliasDeclaration
  );
}

function parseWithProgramProvider(
  filePathOrPaths: string | string[],
  compilerOptions: ts.CompilerOptions,
  parserOpts: ParserOptions,
  programProvider?: () => ts.Program
): ComponentDoc[] {
  const filePaths = Array.isArray(filePathOrPaths)
    ? filePathOrPaths
    : [filePathOrPaths];

  const program = programProvider
    ? programProvider()
    : ts.createProgram(filePaths, compilerOptions);

  const parser = new Parser(program, parserOpts);

  const checker = program.getTypeChecker();

  return filePaths
    .map(filePath => program.getSourceFile(filePath))
    .filter(
      (sourceFile): sourceFile is ts.SourceFile =>
        typeof sourceFile !== 'undefined'
    )
    .reduce<ComponentDoc[]>((docs, sourceFile) => {
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

      if (!moduleSymbol) {
        return docs;
      }

      Array.prototype.push.apply(
        docs,
        checker
          .getExportsOfModule(moduleSymbol)
          .map(exp =>
            parser.getInterfaceInfo(
              exp,
              sourceFile,
              parserOpts.componentNameResolver
            )
          )
          .filter((comp): comp is ComponentDoc => comp !== null)
          .filter((comp, index, comps) =>
            comps
              .slice(index + 1)
              .every(innerComp => innerComp!.displayName !== comp!.displayName)
          )
      );

      return docs;
    }, []);
}
