import React from 'react'
import { ButtonWithIcon } from 'vtex.styleguide'
import { IconCart } from 'vtex.store-icons'
import { useOrderForm } from 'vtex.order-manager/OrderForm'
import { useCssHandles } from 'vtex.css-handles'

import { useMinicartDispatch, useMinicartState } from '../MinicartContext'
import styles from '../styles.css'

const CSS_HANDLES = ['minicartIconContainer', 'minicartQuantityBadge'] as const

const MinicartIconButton = () => {
  const { orderForm, loading } = useOrderForm()
  const handles = useCssHandles(CSS_HANDLES)
  const { open, openOnHover } = useMinicartState()
  const dispatch = useMinicartDispatch()

  const itemQuantity = loading || !orderForm ? 0 : orderForm.items.length

  return (
    <ButtonWithIcon
      icon={
        <span
          onMouseEnter={
            openOnHover ? () => dispatch({ type: 'OPEN_MINICART' }) : undefined
          }
          className={`${handles.minicartIconContainer} gray relative`}
        >
          <IconCart />
          {itemQuantity > 0 && (
            <span
              className={`${handles.minicartQuantityBadge} ${styles.minicartQuantityBadgeDefault} c-on-emphasis absolute t-mini bg-emphasis br4 w1 h1 pa1 flex justify-center items-center lh-solid`}
            >
              {itemQuantity}
            </span>
          )}
        </span>
      }
      variation="tertiary"
      onClick={() =>
        dispatch({ type: open ? 'CLOSE_MINICART' : 'OPEN_MINICART' })
      }
    />
  )
}

export default MinicartIconButton
