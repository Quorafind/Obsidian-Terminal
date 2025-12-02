/**
 * DOM Inspector for debugging xterm structure
 */
export function inspectXTermDOM(container: HTMLElement): void {
    console.log('=== XTerm DOM Inspector ===');
    
    // 递归打印DOM结构
    function printDOMTree(element: Element, depth: number = 0): void {
        const indent = '  '.repeat(depth);
        const tagName = element.tagName.toLowerCase();
        const className = element.className || '(no class)';
        const id = element.id || '(no id)';
        
        console.log(`${indent}${tagName} - class: "${className}" - id: "${id}"`);
        
        // 打印子元素
        Array.from(element.children).forEach(child => {
            printDOMTree(child, depth + 1);
        });
    }
    
    console.log('Container structure:');
    printDOMTree(container);
    
    // 查找关键元素
    const xtermElement = container.querySelector('.xterm');
    const viewport = container.querySelector('.xterm-viewport');
    const scrollArea = container.querySelector('.xterm-scroll-area');
    const screen = container.querySelector('.xterm-screen');
    const textLayer = container.querySelector('.xterm-text-layer');
    const cursorLayer = container.querySelector('.xterm-cursor-layer');
    
    console.log('\n=== Element Search Results ===');
    console.log('xterm element:', xtermElement?.tagName, xtermElement?.className);
    console.log('viewport:', viewport?.tagName, viewport?.className);
    console.log('scroll-area:', scrollArea?.tagName, scrollArea?.className);
    console.log('screen:', screen?.tagName, screen?.className);
    console.log('text-layer:', textLayer?.tagName, textLayer?.className);
    console.log('cursor-layer:', cursorLayer?.tagName, cursorLayer?.className);
    
    // 检查父子关系
    if (screen && scrollArea) {
        console.log('\n=== Parent-Child Relationships ===');
        console.log('screen parent:', screen.parentElement?.className);
        console.log('scroll-area parent:', scrollArea.parentElement?.className);
        console.log('screen is child of scroll-area:', scrollArea.contains(screen));
    }
    
    // 检查所有包含 'xterm' 的类名
    const allXTermElements = container.querySelectorAll('[class*="xterm"]');
    console.log('\n=== All XTerm-related Elements ===');
    allXTermElements.forEach((el, index) => {
        console.log(`${index}: ${el.tagName.toLowerCase()} - "${el.className}"`);
    });
}