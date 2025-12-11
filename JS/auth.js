import { API_URL } from './config.js';
import { LoginResponse } from './LoginResponse.js';

let currentLogin = null;

export function getCurrentLogin() {
  if (currentLogin) return currentLogin;
  const saved = sessionStorage.getItem('loginInfo');
  return saved ? JSON.parse(saved) : null;
}
class AuthService {
  static async login(email, password) {
    try {
      const response = await fetch(`${API_URL}/Auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      
      const resultJson = await response.json();
      const result = new LoginResponse(resultJson);
      if (response.ok && result?.success) {
        sessionStorage.setItem('sessionToken', result.data.sessionToken);
        sessionStorage.setItem('userId', result.data.user.userId);
        currentLogin = result;
        return { success: true };
      }
      return { success: false, message: result?.message || 'Đăng nhập thất bại.' };
    } catch {
      return { success: false, message: 'Đã xảy ra lỗi. Vui lòng thử lại.' };
    }
  }

  static async register(displayName, email, password, confirmPassword) {
    try {
      const response = await fetch(`${API_URL}/Auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, password, confirmPassword }),
      });
      const data = await response.json();
      // Expect server to send success + info that OTP sent to email
      if (response.ok && data?.success) return { success: true, message: data?.message };
      return { success: false, message: data?.message || 'Đăng ký thất bại.' };
    } catch {
      return { success: false, message: 'Đã xảy ra lỗi. Vui lòng thử lại.' };
    }
  }

  static async verifyOtp(email, otp) {
    try {
      // ensure OTP is sent as string
      const code = String(otp ?? '').trim();

      const res = await fetch(`${API_URL}/Auth/VerifyOTP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'email': email, 'code': code }),
      });

      const data = await res.json();
      if (res.ok && data?.success) return { success: true, message: data?.message };
      return { success: false, message: data?.message || 'Mã OTP không hợp lệ.' };
    } catch {
      return { success: false, message: 'Không thể xác thực OTP. Vui lòng thử lại.' };
    }
  }

  static async resendOtp(email) {
    try {
      const res = await fetch(`${API_URL}/Auth/SendOTP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, 'purpose': 'registration' }),
      });
      const data = await res.json();
      if (res.ok && data?.success) return { success: true, message: data?.message };
      return { success: false, message: data?.message || 'Không thể gửi lại OTP.' };
    } catch {
      return { success: false, message: 'Không thể gửi lại OTP. Vui lòng thử lại.' };
    }
  }

  static logout() {
    localStorage.removeItem('token');
    window.location.href = '/index.html';
  }
}

export { AuthService };
// UI logic
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  // Elements for OTP modal (present on register.html)
  const otpModalBackdrop = document.getElementById('otpModalBackdrop');
  const otpInput = document.getElementById('otpInput');
  const otpModalMessage = document.getElementById('otpModalMessage');
  const otpModalHint = document.getElementById('otpModalHint');
  const confirmOtpBtn = document.getElementById('confirmOtpBtn');
  const resendBtn = document.getElementById('resendBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');

  const otpState = {
    email: '',
    timerId: null,
    cooldown: 30,
  };

  function openOtpModal(email) {
    otpState.email = email;
    otpModalHint && (otpModalHint.textContent = `Mã đã được gửi tới ${email}. Vui lòng nhập mã (6 chữ số).`);
    otpModalMessage && (otpModalMessage.textContent = '');
    if (otpModalBackdrop) {
      otpModalBackdrop.hidden = false;
      otpModalBackdrop.classList.remove('closing');
      // Force reflow before adding 'open' to trigger transition
      void otpModalBackdrop.offsetWidth;
      otpModalBackdrop.classList.add('open');
      otpModalBackdrop.setAttribute('aria-hidden', 'false');
    }
    otpInput && (otpInput.value = '', otpInput.focus());
    startResendCountdown();
  }

  function closeOtpModal() {
    if (otpModalBackdrop) {
      otpModalBackdrop.classList.remove('open');
      otpModalBackdrop.classList.add('closing');
      otpModalBackdrop.setAttribute('aria-hidden', 'true');
      const onEnd = () => {
        otpModalBackdrop.hidden = true;
        otpModalBackdrop.classList.remove('closing');
        otpModalBackdrop.removeEventListener('transitionend', onEnd);
      };
      otpModalBackdrop.addEventListener('transitionend', onEnd);
    }
    stopResendCountdown();
    otpState.email = '';
  }

  function setResendButton(enabled, label) {
    if (!resendBtn) return;
    resendBtn.disabled = !enabled;
    resendBtn.textContent = label;
  }

  function startResendCountdown() {
    stopResendCountdown();
    let remaining = otpState.cooldown;
    setResendButton(false, `Gửi lại (${remaining}s)`);
    otpState.timerId = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        stopResendCountdown();
        setResendButton(true, 'Gửi lại');
      } else {
        setResendButton(false, `Gửi lại (${remaining}s)`);
      }
    }, 1000);
  }

  function stopResendCountdown() {
    if (otpState.timerId) {
      clearInterval(otpState.timerId);
      otpState.timerId = null;
    }
  }

  // Login form handler (unchanged)
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email')?.value?.trim();
      const password = document.getElementById('password')?.value;
      const messageEl = document.getElementById('login-message');

      const result = await AuthService.login(email, password);
      if (result.success) {
        if (messageEl) {
          messageEl.textContent = 'Đăng nhập thành công! Đang chuyển hướng...';
          messageEl.className = 'message success';
        }
        setTimeout(() => { window.location.href = '../index.html'; }, 1500);
      } else {
        if (messageEl) {
          messageEl.textContent = result.message;
          messageEl.className = 'message error';
        }
      } 
    });
  }

  // Register form handler with OTP flow
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const displayName = document.getElementById('displayName')?.value?.trim();
      const email = document.getElementById('email')?.value?.trim();
      const password = document.getElementById('password')?.value;
      const confirmPassword = document.getElementById('confirmPassword')?.value;
      const messageEl = document.getElementById('register-message');

      // Basic client-side checks
      if (!displayName || !email || !password || !confirmPassword) {
        if (messageEl) {
          messageEl.textContent = 'Vui lòng nhập đầy đủ thông tin.';
          messageEl.className = 'message error';
        }
        return;
      }
      if (password !== confirmPassword) {
        if (messageEl) {
          messageEl.textContent = 'Mật khẩu xác nhận không khớp.';
          messageEl.className = 'message error';
        }
        return;
      }

      const res = await AuthService.resendOtp(email);
      if (res.success) {
        otpModalMessage && (otpModalMessage.textContent = 'Đã gửi lại mã OTP.');
        otpModalMessage && (otpModalMessage.className = 'message info');
        startResendCountdown();
      } else {
        otpModalMessage && (otpModalMessage.textContent = res.message);
        otpModalMessage && (otpModalMessage.className = 'message error');
      }

      // Call register API first
      const result = await AuthService.register(displayName, email, password, confirmPassword);
      if (result.success) {
        if (messageEl) {
          messageEl.textContent = 'Đăng ký thành công. Vui lòng kiểm tra email để nhập OTP.';
          messageEl.className = 'message info';
        }
        // Only now show OTP modal
        openOtpModal(email);
      } else {
        if (messageEl) {
          messageEl.textContent = result.message;
          messageEl.className = 'message error';
        }
      }
    });
  }

  // OTP modal actions
  if (confirmOtpBtn) {
    confirmOtpBtn.addEventListener('click', async () => {
        const otp = otpInput?.value?.trim();
        const result = await AuthService.verifyOtp(otpState.email, otp);
        if (result.success) {
          otpModalMessage && (otpModalMessage.textContent = 'Xác thực OTP thành công! Đang chuyển hướng...');
          setTimeout(() => {
            window.location.href = 'login.html';
            }, 1500);
        }
        else {
          otpModalMessage && (otpModalMessage.textContent = result.message);
          otpModalMessage && (otpModalMessage.className = 'message error');
        }
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (resendBtn.disabled) return;
      const { email } = otpState;
      setResendButton(false, 'Đang gửi...');
      const res = await AuthService.resendOtp(email);
      if (res.success) {
        otpModalMessage && (otpModalMessage.textContent = 'Đã gửi lại mã OTP.');
        otpModalMessage && (otpModalMessage.className = 'message info');
        startResendCountdown();
      } else {
        otpModalMessage && (otpModalMessage.textContent = res.message);
        otpModalMessage && (otpModalMessage.className = 'message error');
        // Allow retry quickly
        setResendButton(true, 'Gửi lại');
      }
    });
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      closeOtpModal();
    });
  }
});
