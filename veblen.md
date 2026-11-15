# veblen函数
## 1.定义
### 1.1 二元版本
1.$T$:
- $0\in T$
- $(a,b)\in PT\times T\Rightarrow a+b\in T$
- $(a,b)\in T^2\Rightarrow \varphi_a(b)\in T$
2.$PT\subset T$:
- $0\in PT$
- $(a,b)\in T\Rightarrow \varphi_a(b)\in PT$
3.对于$x[n]:T\cdot On\to T$:
- 若$n>\text{cof}(x)$:
- - $x[n]=x[\text{cof}(x)]$
- 若$n=\text{cof}(x)$
- - $x[n]=x$
- 若 $x=a+b$: 
- -  $x[n]=a+b[n],\text{cof}(x)=\text{cof}(b)$
- 若 $x=\varphi_a(b)$:
- - 若$a=0$:
- - - 若$b=0$:
- - - - $x[n]=n,\text{cof}(x)=1$,记$1=\varphi_0(0)$
- - - 若$b=b'+1$,即$\text{cof}(b)=1$:
- - - - $x[0]=\varphi_a(b'),x[n+1]=x[n]+\varphi_a(b'),\text{cof}(x)=\omega$
- - 若$a=a'+1$:
- - - 若$b=0$:
- - - - $x[0]=\varphi_{a'}(0),x[n+1]=\varphi_{a'}(x[n]),\text{cof}(x)=\omega$
- - - 若$b=b'+1$,即$\text{cof}(b)=1$:
- - - - $x[0]=\varphi_{a}(b')+1,x[n+1]=\varphi_{a'}(x[n]),\text{cof}(x)=\omega$
- - 若$\text{cof}(b)\ge\omega$:
- - - $x[n]=\varphi_{a}(b[n]),\text{cof}(x)=\text{cof}(b)$
- - 若$\text{cof}(a)\ge\omega$:
- - - $x[n]=\varphi_{a[n]}(b),\text{cof}(x)=\text{cof}(a)$
  
4.对于$\mathcal{o}(x):T\to On$:
- 若 $x=0$:
- - $\mathcal{o}(x)=0$
- 若 $x=x'+1$,即$\text{cof}(x)=1$:
- - $\mathcal{o}(x)=\mathcal{o}(x')+1$
- 若 $\text{cof}(x)\ge\omega$:
- - $\mathcal{o}(x)[n]=\mathcal{o}(x[n]),\text{cf}(\mathcal{o}(x))=\text{cof}(x),\mathcal{o}(x)=sup\{\mathcal{o}(x)[n]\mid n < cf(\mathcal{o}(x))\}$




5.对于命题$x,y\in T,x> y$：
- 若 $x=0$:
- - $\nvdash x> y$
- 若 $x = a + b,y = c + d$:
- - 若 $a > c$
- - - $\vdash x > y$
- - 若 $a = c$
- - - $\vdash x > y \leftrightarrow b > d$
- 若 $x=a+b,y\in PT\setminus \{0\}$:
- - $\vdash x > y \leftrightarrow x > y + 0$
- 若 $x\in PT\setminus \{0\},y=c+d$:
- - $\vdash x > y \leftrightarrow x + 0 > y$
- 若 $x=\varphi_a(b),y=\varphi_c(d)$:
- - 若 $a=c$:
- - - $\vdash x > y \leftrightarrow b > d$
- - 若 $a>c$:
- - - $\vdash x > y \leftrightarrow x > d$
- - 若 $a<c$:
- - - $\vdash x > y \leftrightarrow b > y$
  
6.以此定义 $ <,\le,\ge,=$


7.$OT\subset T$
- $0\in OT$
- $(a,b)\in OT^2\land \varphi_a(b) > b \Rightarrow \varphi_a(b)\in OT$
- $a\in OT\Rightarrow \varphi_a(0)\in OT$
- $(a,b)\in (OT\cap PT)\times OT\land a\ge b\Rightarrow a+b\in OT$
### 1.2 有限维元版本
1.$T$:
- $0\in T$
- $(a,b)\in PT\times T\Rightarrow a+b\in T$
- $(a_i)_{i\in L\in \mathbb{N}}\in T^{L+1}\Rightarrow \varphi(a_L,...,a_0)\in T$
  
2.$PT\subset T$:
- $0\in PT$
- $(a_i)_{i\in L\in \mathbb{N}}\in T^{L+1}\Rightarrow \varphi(a_L,...,a_0)\in PT$  
  
3.对于$x[n]:T\cdot On\to T$:
- 若$n>\text{cof}(x)$:
- - $x[n]=x[\text{cof}(x)]$
- 若$n=\text{cof}(x)$
- - $x[n]=x$
- 若 $x=a+b$: 
- -  $x[n]=a+b[n],\text{cof}(x)=\text{cof}(b)$
- 若 $x=\varphi(a)$:
- - 若$a=0$:
- - - $x[n]=n,\text{cof}(x)=1$,记$1=\varphi(0)$
- - 若$a=a'+1$,即$\text{cof}(a)=1$:
- - - $x[0]=\varphi(a'),x[n+1]=x[n]+\varphi(a'),\text{cof}(x)=\omega$
- - 若$\text{cof}(a)\ge\omega$:
- - - $x[n]=\varphi_{a[n]}(0),\text{cof}(x)=\text{cof}(a)$
- 若$x=\varphi(a_L,...,a_i,\underbrace{...}_{m个0},a_0),0<i\le L,a_j=0(0<j<i)$:
- - 若$a_i=a_i'+1$
- - - 若$a_0=0$:
- - - - $x[0]=0,x[n+1]=\varphi(a_L,...,a_i',x[n],\underbrace{...}_{m个0}),\text{cof}(x)=\omega$
- - - 若$a_0=a_0'+1$:
- - - - $x[0]=\varphi(a_L,...,a_i,...,a_0'),x[n+1]=\varphi(a_L,...,a_i',x[n],a_{i-2},\underbrace{...}_{m个0}),\text{cof}(x)=\omega$
- - - 若$\text{cof}(a_0)\ge\omega$:
- - - - $x[n]=\varphi(a_L,...,a_i,\underbrace{...}_{m个0},a_0[n]),\text{cof}(x)=\text{cof}(a)$
- - 若$\text{cof}(a_i)\ge\omega$:
- - - $x[n]=\varphi(a_L,...,a_i[n],\underbrace{...}_{m个0},a_0),\text{cof}(x)=\text{cof}(a)$
  
4.对于$\mathcal{o}(x):T\to On$:
- 若 $x=0$:
- - $\mathcal{o}(x)=0$
- 若 $x=x'+1$,即$\text{cof}(x)=1$:
- - $\mathcal{o}(x)=\mathcal{o}(x')+1$
- 若 $\text{cof}(x)\ge\omega$:
- - $\mathcal{o}(x)[n]=\mathcal{o}(x[n]),\text{cf}(\mathcal{o}(x))=\text{cof}(x),\mathcal{o}(x)=sup\{\mathcal{o}(x)[n]\mid n < cf(\mathcal{o}(x))\}$
  

<!-- 
5.对于命题$x,y\in T,x> y$：
- 若 $x=0$:
- - $\nvdash x> y$
- 若 $x = a + b,y = c + d$:
- - 若 $a > c$
- - - $\vdash x > y$
- - 若 $a = c$
- - - $\vdash x > y \leftrightarrow b > d$
- 若 $x=a+b,y\in PT\setminus \{0\}$:
- - $\vdash x > y \leftrightarrow x > y + 0$
- 若 $x\in PT\setminus \{0\},y=c+d$:
- - $\vdash x > y \leftrightarrow x + 0 > y$
- 若 $x=\varphi(a_{L_1},...,a_0),y=\varphi(b_{L_2},...,b_0)$:
- - 若 $L_1=L_2$:
- -  -->
  



