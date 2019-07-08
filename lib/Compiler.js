const fs = require('fs')
const path = require('path')

const babylon = require('babylon')
const t = require('@babel/types')
const traverse = require('@babel/traverse').default
const generator = require('@babel/generator').default
const ejs = require('ejs')

class Compiler {
    constructor(config) {
        this.config = config
        this.entryId = ''
        this.modules = {}
        this.entry = config.entry
        // 工作路径
        this.root = process.cwd()
    }
    run() {
        // 创建依赖关系
        // true代表主模块
        this.buildModule(path.resolve(this.root, this.entry), true)
        this.emitFile()
    }
    getSource(modulePath) {
        const content = fs.readFileSync(modulePath, 'utf-8')
        return content
    }
    // AST解析语法树
    parse(source, parentPath) {
        const ast = babylon.parse(source)
        const dependencies = []
        traverse(ast, {
            CallExpression(p) {
                let node = p.node
                if(node.callee.name === 'require') {
                    node.callee.name = '__webpack_require__'
                    let moduleName = node.arguments[0].value
                    moduleName = moduleName + (path.extname(moduleName) ? '' : '.js')
                    moduleName = './' + path.join(parentPath, moduleName)
                    dependencies.push(moduleName)
                    node.arguments = [t.stringLiteral(moduleName)]
                }
            }
        })
        const sourceCode = generator(ast).code
        return { sourceCode, dependencies}
    }
    buildModule(modulePath, isEntry) {
        const source = this.getSource(modulePath)
        const moduleName = './' + path.relative(this.root, modulePath)
        if(isEntry) {
            this.entryId = moduleName
        }
        const {sourceCode, dependencies } = this.parse(source, path.dirname(moduleName))

        this.modules[moduleName] = sourceCode
        dependencies.forEach(dep => {
            this.buildModule(path.join(this.root, dep), false)
        })
    }
    emitFile() {
        const main = path.join(this.config.output.path, this.config.output.filename)
        const templateStr = this.getSource(path.join(__dirname, 'main.ejs'))
        const code = ejs.render(templateStr, {entryId: this.entryId, modules: this.modules})
        this.assets = {}
        this.assets[main] = code
        fs.writeFileSync(main, this.assets[main])
    }
}

module.exports = Compiler
