import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { signColor, fmt } from '../../lib/colors';
import { snapToTick, tickSize } from '../../lib/krxTick';
import {
  validateBuy,
  validateSell,
  fee,
  marketOrderPrice,
  chipQty,
  referencePrice,
  type Orderbook,
} from '../../lib/paperOrders';
import {
  Button,
  Segmented,
  Badge,
  Modal,
  EmptyState,
  ErrorState,
  Loading,
} from '@/components/common';
import toast from '@/lib/toast';
import type { Market, PaperOrder, Portfolio, Orderable } from '@/data/types';

interface OrderTicketProps {
  code: string;
  name: string;
  market: Market;
  price: number;
  orderbook?: Orderbook;
  lastTradePrice: number;
  portfolio: Portfolio | null;
  /** 호가창 클릭으로 고른 가격. seq로 같은 가격 재클릭도 반영한다. */
  picked?: { price: number; seq: number } | null;
}

export default function OrderTicket({
  code,
  name,
  market,
  price,
  orderbook,
  lastTradePrice,
  portfolio,
  picked,
}: OrderTicketProps) {
  const mode = useStore(st => st.colorMode);
  const placePaperOrder = useStore(st => st.placePaperOrder);
  const submitOrder = useStore(st => st.submitOrder);
  const fetchOrderable = useStore(st => st.fetchOrderable);

  // UI state
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [qty, setQty] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<number>(price);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** KIS 주문가능금액. null = 아직 못 읽음(주문 불가로 취급). */
  const [orderable, setOrderable] = useState<Orderable | null>(null);

  // 기준가는 실호가·실체결에서만 만든다. `price` prop은 getStockDetail이 아직 목이라
  // 실가와 몇 배씩 벌어질 수 있어 주문 단가로 쓰지 않는다.
  const refPrice = referencePrice(orderbook, lastTradePrice);

  /** 사용자가 지정가를 직접 만졌나 — 만지기 전에는 렌더 시점에 실호가 기준가로 파생 표시한다.
   *  effect 채움만으로는 SSE 첫 프레임~effect 사이에 "지정가 0 + 빨간 에러" 창이 생겼다(ISSUE-003 실측). */
  const [priceTouched, setPriceTouched] = useState(false);

  // 훅은 전부 조기 return 이전에 — 조건부 훅은 포트폴리오 로드 전→후 전환에서 앱을 크래시시킨다(Rules of Hooks).
  // 종목이 바뀌면 비우고, 실가가 도착하면 채운다(tick마다 덮으면 사용자 입력이 날아간다).
  // (effect 대신 렌더 중에 이전 값과 비교해 조정한다 — React 권장 패턴)
  // 기존 effect 와 같게: 마운트에도 한 번 비우고(prevCode=null), 실가 채움은 마운트 이후 변화에만 반응한다.
  const [prevCode, setPrevCode] = useState<string | null>(null);
  const [prevRefPrice, setPrevRefPrice] = useState(refPrice);
  let nextLimit = limitPrice;
  if (code !== prevCode) {
    setPrevCode(code);
    nextLimit = 0;
    setLimitPrice(0);
    setQty(1);
    setPriceTouched(false);
  }
  if (refPrice !== prevRefPrice) {
    setPrevRefPrice(refPrice);
    if (nextLimit <= 0 && refPrice > 0) setLimitPrice(snapToTick(refPrice));
  }

  /** 화면·검증이 쓰는 지정가 — 손대기 전이면 실호가 기준가를 즉시 파생(상태 채움을 기다리지 않는다). */
  const effectiveLimit =
    limitPrice > 0
      ? limitPrice
      : !priceTouched && refPrice > 0
        ? snapToTick(refPrice)
        : limitPrice;

  // 호가 클릭 → 지정가 모드 전환 + 채움. seq 가 바뀔 때만(같은 가격 재클릭도 seq 는 오른다).
  const [prevPickSeq, setPrevPickSeq] = useState<number | undefined>(undefined);
  if (picked?.seq !== prevPickSeq) {
    setPrevPickSeq(picked?.seq);
    if (picked && picked.price > 0) {
      setType('limit');
      setLimitPrice(snapToTick(picked.price));
    }
  }

  // 주문 가격 — 조기 return 이전에 계산한다(주문가능금액 조회가 이 값에 의존한다).
  const orderPrice =
    type === 'market'
      ? marketOrderPrice(
          side,
          orderbook || { asks: [], bids: [] },
          lastTradePrice,
          refPrice,
        )
      : snapToTick(effectiveLimit);

  // 주문가능금액은 KIS에서 읽는다. 미체결분이 이미 차감된 값이라 로컬에서 다시 빼면 이중 차감.
  // 단가가 바뀔 때마다 때리지 않도록 300ms 디바운스.
  useEffect(() => {
    // 매도는 보유수량만 보면 되므로 조회하지 않는다(KIS 초당 호출 제한을 아낀다).
    if (market !== 'KR' || side !== 'buy' || !(orderPrice > 0)) return;
    let alive = true;
    const t = setTimeout(() => {
      fetchOrderable(code, type, orderPrice).then(o => {
        if (alive) setOrderable(o);
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code, type, orderPrice, market, side, fetchOrderable]);

  // US 종목 처리
  if (market === 'US') {
    return <EmptyState title="모의 주문은 KR 종목만 지원" />;
  }

  // 포트폴리오 검증 — null은 아직 로딩(일괄 로드 전)이다. 실패는 unavailable로 따로 온다.
  // 로딩을 에러로 그리면 리로드 때마다 "불러올 수 없습니다"가 번쩍인다(ISSUE-003 동류).
  if (!portfolio) {
    return <Loading label="잔고 불러오는 중" />;
  }

  if (portfolio.unavailable) {
    return (
      <ErrorState
        title="주문 불가 상태입니다"
        desc="포트폴리오 데이터에 연결되어 있지 않습니다."
      />
    );
  }

  // 잔고는 KIS 단일 소스 — 보유수량은 계좌 그대로, 주문가능금액은 inquire-psbl-order.
  const held = portfolio.holdings.find(h => h.code === code);
  // 매도가능수량 기준 — 미체결 매도가 걸린 주식을 또 팔지 않도록. 없으면 보유수량으로.
  const heldQty = held?.sellableQty ?? held?.qty ?? 0;
  const orderableCash = orderable?.cash ?? 0;

  // 비용/수익 계산
  const totalAmount = orderPrice * qty;
  const totalFee = fee(totalAmount);
  const totalCost =
    side === 'buy' ? totalAmount + totalFee : totalAmount - totalFee;

  // 주문 후 주문가능금액(추정) — 확정값은 주문 뒤 KIS 재조회로 갱신된다.
  const afterCash =
    side === 'buy' ? orderableCash - totalCost : orderableCash + totalCost;

  // 유효성 검증. 최종 판단은 KIS가 하고, 거부 사유는 그대로 노출한다.
  // 매도에는 주문가능금액이 필요 없다 — 보유수량만 본다.
  const validation = !(refPrice > 0)
    ? {
        ok: false as const,
        error:
          '실시간 시세를 아직 받지 못했습니다. 호가가 들어오면 주문할 수 있습니다.',
      }
    : !(orderPrice > 0)
      ? { ok: false as const, error: '주문 단가를 입력하세요.' }
      : side === 'sell'
        ? validateSell(qty, heldQty)
        : !orderable
          ? { ok: false as const, error: '주문가능금액을 확인하는 중입니다.' }
          : validateBuy(qty, orderPrice, orderableCash);

  const isValid = validation.ok;
  const errorMsg = !validation.ok ? validation.error : '';
  /** 로딩성 안내(시세 대기·주문가능금액 조회 중)는 빨간 에러 톤이 아니라 중립 톤 — 에러로 보이면
   *  사용자가 뭘 잘못했다고 읽는다(ISSUE-003 동류). */
  const isPendingInfo =
    !validation.ok &&
    (!(refPrice > 0) || (side === 'buy' && orderPrice > 0 && !orderable));

  // 칩 수량 계산 (도메인 로직 재사용)
  const chip = (pct: number) =>
    chipQty(pct, side, orderPrice, orderableCash, heldQty);

  const handleSetQty = (newQty: number) => {
    setQty(Math.max(1, newQty));
  };

  const handleLimitPriceBlur = () => {
    setLimitPrice(snapToTick(effectiveLimit));
  };

  const handleLimitPriceStepChange = (delta: number) => {
    const tick = tickSize(effectiveLimit);
    setPriceTouched(true);
    setLimitPrice(snapToTick(effectiveLimit + delta * tick));
  };

  const handlePlaceOrder = () => {
    if (!isValid) {
      toast.error({ message: errorMsg });
      return;
    }
    setShowModal(true);
  };

  const handleConfirmOrder = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await submitOrder({
        code,
        side,
        qty,
        ordType: type,
        ...(type === 'limit' && { price: orderPrice }),
      });

      if (!r.ok) {
        // KIS 거부 사유를 그대로 보여준다("장 시간이 아닙니다" 등). 임의 문구로 덮으면 원인을 못 찾는다.
        toast.error({ message: r.message });
        return;
      }

      // 접수된 주문만 이력에 남긴다 — 주문번호가 계좌에 들어갔다는 증거.
      // 금액 계산에는 쓰지 않는다(잔고는 KIS 재조회로 이미 갱신됨).
      // 아래 Date.now() 두 곳은 주문 확인 핸들러(await 이후) 안이다 — 렌더 중 호출이 아니다
      placePaperOrder({
        // eslint-disable-next-line react-hooks/purity -- 제출 핸들러 안의 주문 id(주문번호 없을 때 대체)
        id: r.orderNo || `${Date.now()}`,
        code,
        name,
        market,
        side,
        type,
        price: orderPrice,
        qty,
        fee: totalFee,
        // eslint-disable-next-line react-hooks/purity -- 제출 핸들러 안의 접수 시각
        at: Date.now(),
        ...(r.orderNo && { orderNo: r.orderNo }),
      } satisfies PaperOrder);

      toast.success({ message: r.message });
      setShowModal(false);
      setQty(1);
      setLimitPrice(refPrice > 0 ? snapToTick(refPrice) : 0); // 목 price가 아니라 실호가 기준
      // 주문가능금액 재조회 — 방금 주문분이 빠진 값으로 갱신
      fetchOrderable(code, type, orderPrice).then(setOrderable);
    } catch (e) {
      toast.error({
        message: e instanceof Error ? e.message : '주문 전송 실패',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const sideColor = signColor(side === 'buy' ? 1 : -1, mode);

  return (
    <div className="card" style={{ padding: '16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          모의 주문
        </h3>
        <span className="tag mono" style={{ fontSize: 10 }}>
          KIS 모의계좌 실주문
        </span>
      </div>

      {/* 매수/매도 토글 */}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={[
            { value: 'buy' as const, label: '매수' },
            { value: 'sell' as const, label: '매도' },
          ]}
          value={side}
          onChange={v => setSide(v as 'buy' | 'sell')}
          className="w-full"
        />
      </div>

      {/* 지정가/시장가 토글 */}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={[
            { value: 'limit' as const, label: '지정가' },
            { value: 'market' as const, label: '시장가' },
          ]}
          value={type}
          onChange={v => setType(v as 'limit' | 'market')}
          className="w-full"
        />
      </div>

      {/* 지정가 입력 */}
      {type === 'limit' && (
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              fontSize: 11,
              color: 'var(--text-sub)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            지정가
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <input
                type="number"
                value={effectiveLimit}
                onChange={e => {
                  setPriceTouched(true);
                  setLimitPrice(Number(e.target.value));
                }}
                onBlur={handleLimitPriceBlur}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'var(--mono)',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => handleLimitPriceStepChange(-1)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text-sub)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                −
              </button>
              <button
                onClick={() => handleLimitPriceStepChange(1)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text-sub)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* 호가 클릭 옵션 */}
          {orderbook && (
            <div
              style={{ marginTop: 8, fontSize: 11, color: 'var(--text-sub)' }}
            >
              <div style={{ marginBottom: 4 }}>
                {orderbook.asks.length > 0 && (
                  <button
                    onClick={() => setLimitPrice(orderbook.asks[0].price)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: signColor(-1, mode),
                      cursor: 'pointer',
                      fontSize: 11,
                      textDecoration: 'underline',
                      marginRight: 8,
                    }}
                  >
                    최우선매도 {fmt(orderbook.asks[0].price, 0)}
                  </button>
                )}
              </div>
              <div>
                {orderbook.bids.length > 0 && (
                  <button
                    onClick={() => setLimitPrice(orderbook.bids[0].price)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: signColor(1, mode),
                      cursor: 'pointer',
                      fontSize: 11,
                      textDecoration: 'underline',
                    }}
                  >
                    최우선매수 {fmt(orderbook.bids[0].price, 0)}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 수량 입력 */}
      <div style={{ marginBottom: 12 }}>
        <label
          style={{
            fontSize: 11,
            color: 'var(--text-sub)',
            display: 'block',
            marginBottom: 6,
          }}
        >
          수량
        </label>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => handleSetQty(qty - 1)}
                style={{
                  flex: '0 0 28px',
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text-sub)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                −
              </button>
              <input
                type="number"
                value={qty}
                onChange={e => handleSetQty(Number(e.target.value))}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'var(--mono)',
                  textAlign: 'center',
                }}
              />
              <button
                onClick={() => handleSetQty(qty + 1)}
                style={{
                  flex: '0 0 28px',
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text-sub)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* 칩 버튼 */}
        <div
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}
        >
          {side === 'buy' && (
            <>
              {[10, 25, 50, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => handleSetQty(chip(pct))}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: 'var(--panel-2)',
                    color: 'var(--text-sub)',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 500,
                  }}
                >
                  {pct}%
                </button>
              ))}
            </>
          )}
          {side === 'sell' && (
            <>
              {[10, 25, 50, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => handleSetQty(chip(pct))}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: 'var(--panel-2)',
                    color: 'var(--text-sub)',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 500,
                  }}
                  title={`${heldQty}주 중 ${pct}%`}
                >
                  {pct}%
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* 요약 영역 */}
      <div
        style={{
          padding: '12px',
          borderRadius: 8,
          background: 'var(--panel-2)',
          marginBottom: 12,
          fontSize: 11,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={{ color: 'var(--text-sub)' }}>
            {side === 'buy' ? '주문가능금액' : '매도가능수량'}
          </span>
          <span
            className="mono"
            style={{
              color: orderable ? 'var(--text)' : 'var(--text-mut)',
              fontWeight: 600,
            }}
          >
            {side === 'buy'
              ? orderable
                ? `₩${fmt(orderableCash, 0)}`
                : '조회 중…'
              : `${fmt(heldQty, 0)}주`}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={{ color: 'var(--text-sub)' }}>체결금액</span>
          <span
            style={{
              color: 'var(--text)',
              fontFamily: 'var(--mono)',
              fontWeight: 600,
            }}
          >
            ₩{fmt(totalAmount, 0)}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={{ color: 'var(--text-sub)' }}>수수료(예상)</span>
          <span
            style={{
              color: 'var(--text)',
              fontFamily: 'var(--mono)',
              fontWeight: 600,
            }}
          >
            ₩{fmt(totalFee, 0)}
          </span>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>
              {side === 'buy' ? '주문 후 주문가능금액' : '주문 후 보유'}
            </span>
            <span
              style={{
                color: 'var(--text)',
                fontFamily: 'var(--mono)',
                fontWeight: 600,
              }}
            >
              {/* 주문가능금액 조회 전엔 0 - 비용 = 음수가 찍힌다 — 모르는 값은 '-'다. */}
              {side === 'buy'
                ? orderable
                  ? `₩${fmt(afterCash, 0)}`
                  : '-'
                : `${fmt(heldQty - qty, 0)}주`}
            </span>
          </div>
        </div>
      </div>

      {/* 오류·안내 표시 — 로딩성 안내는 중립 톤(빨간 박스는 "내 잘못"으로 읽힌다) */}
      {errorMsg && (
        <div
          style={{
            padding: '8px',
            borderRadius: 6,
            background: isPendingInfo ? 'var(--panel-2)' : 'var(--bad-bg)',
            marginBottom: 12,
            fontSize: 11,
            color: isPendingInfo ? 'var(--text-sub)' : 'var(--bad)',
            lineHeight: 1.4,
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* 주문 버튼 */}
      <Button
        onClick={handlePlaceOrder}
        disabled={!isValid}
        block
        variant="primary"
        style={{ background: sideColor }}
      >
        {side === 'buy' ? '매수' : '매도'} {qty}주 주문
      </Button>

      {/* 확인 모달 */}
      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title="주문 확인"
        width={380}
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={() => setShowModal(false)} variant="subtle" block>
              취소
            </Button>
            <Button
              onClick={handleConfirmOrder}
              loading={submitting}
              block
              style={{ background: sideColor }}
            >
              확정
            </Button>
          </div>
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px',
            borderRadius: 8,
            background: 'var(--panel-2)',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>종목</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>
              {name}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>구분</span>
            <Badge color={sideColor}>{side === 'buy' ? '매수' : '매도'}</Badge>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>수량</span>
            <span
              style={{
                color: 'var(--text)',
                fontFamily: 'var(--mono)',
                fontWeight: 600,
              }}
            >
              {qty}주
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-sub)' }}>가격</span>
            <span
              style={{
                color: 'var(--text)',
                fontFamily: 'var(--mono)',
                fontWeight: 600,
              }}
            >
              ₩{fmt(orderPrice, 0)} ({type === 'market' ? '시장가' : '지정가'})
            </span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span style={{ color: 'var(--text-sub)' }}>체결금액</span>
              <span
                style={{
                  color: 'var(--text)',
                  fontFamily: 'var(--mono)',
                  fontWeight: 600,
                }}
              >
                ₩{fmt(totalAmount, 0)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-sub)' }}>수수료</span>
              <span
                style={{
                  color: 'var(--text)',
                  fontFamily: 'var(--mono)',
                  fontWeight: 600,
                }}
              >
                ₩{fmt(totalFee, 0)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 6,
                borderTop: '1px solid var(--border)',
                paddingTop: 6,
              }}
            >
              <span style={{ color: 'var(--text-sub)', fontWeight: 600 }}>
                합계
              </span>
              <span
                style={{
                  color: sideColor,
                  fontFamily: 'var(--mono)',
                  fontWeight: 700,
                }}
              >
                ₩{fmt(totalCost, 0)}
              </span>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
