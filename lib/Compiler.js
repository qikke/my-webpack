const fs = require('fs')
const path = require('path')

const babylon = require('babylon')
const t = require('@babel/types')
const traverse = require('@babel/traverse').default
const generator = require('@babel/generator').default
const ejs = require('ejs')
const { SyncHook } = require('tapable')

class Compiler {
    constructor(config) {
        this.config = config
        this.entryId = ''
        this.modules = {}
        this.entry = config.entry
        // 工作路径
        this.root = process.cwd()
        this.hooks = {
            entryOption: new SyncHook(),
            compile: new SyncHook(),
            afterCompile: new SyncHook(),
            afterPlugins: new SyncHook(),
            run: new SyncHook(),
            emit: new SyncHook(),
            done: new SyncHook(),
        }
        const plugins = this.config.plugins
        if(Array.isArray(plugins)) {
            plugins.forEach(plugin => {
                plugin.apply(this)
            })
        }
        this.hooks.afterPlugins.call()
    }
    run() {
        this.hooks.run.call()
        this.hooks.compile.call()
        // 创建依赖关系
        // true代表主模块
        this.buildModule(path.resolve(this.root, this.entry), true)
        this.hooks.afterCompile.call()
        this.emitFile()
        this.hooks.emit.call()
        this.hooks.done.call()
    }
    getSource(modulePath) {
        const rules = this.config.module.rules
        let content = fs.readFileSync(modulePath, 'utf-8')
        for(let i = 0; i < rules.length; i++) {
            let rule = rules[i]
            let {test, use} = rule
            let len = use.length - 1
            if(test.test(modulePath)) {
                function normalLoader() {
                    let loader = require(use[len--])
                    content = loader(content)
                    if(len >= 0) {
                        normalLoader()
                    }
                }
                normalLoader()
            }
        }
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
        let sourceCode, dependencies
        if(/\.js$/.test(modulePath)) {
            const res = this.parse(source, path.dirname(moduleName))
            sourceCode = res.sourceCode
            dependencies = res.dependencies
        }else {
            sourceCode = source
            dependencies = []
        }
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
