import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'
import { useTheme } from './theme-provider'

export function ModeToggle() {
  const { setTheme } = useTheme()

  const toggleTheme = (event: React.MouseEvent<HTMLButtonElement>) => {
    const isDark = document.documentElement.classList.contains('dark')
    const nextTheme = isDark ? 'light' : 'dark'

    if (!(document as any).startViewTransition) {
      setTheme(nextTheme)
      return
    }

    const x = event.clientX
    const y = event.clientY
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )

    const transition = (document as any).startViewTransition(() => {
      setTheme(nextTheme)
    })

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ]
      document.documentElement.animate(
        {
          clipPath: clipPath,
        },
        {
          duration: 500,
          easing: 'ease-in',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      title="Toggle theme"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
