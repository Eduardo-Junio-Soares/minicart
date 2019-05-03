import classNames from 'classnames'
import hoistNonReactStatics from 'hoist-non-react-statics'
import PropTypes from 'prop-types'
import { identity, map, partition, path, pathOr, pick } from 'ramda'
import React, { Component, useEffect } from 'react'
import { Button, withToast } from 'vtex.styleguide'
import { isMobile } from 'react-device-detect'
import { withRuntimeContext } from 'vtex.render-runtime'
import { IconCart } from 'vtex.store-icons'
import { orderForm } from 'vtex.store-resources/Queries'
import { addToCart, updateItems } from 'vtex.store-resources/Mutations'
import { Pixel } from 'vtex.pixel-manager/PixelContext'
import { compose, graphql, withApollo } from 'react-apollo'
import { injectIntl, intlShape } from 'react-intl'

import MiniCartContent from './components/MiniCartContent'
import { MiniCartPropTypes } from './propTypes'
import Sidebar from './components/Sidebar'
import Popup from './components/Popup'
import { shouldShowItem } from './utils/itemsHelper'

import { fullMinicartQuery } from './localState/queries'
import {
  addToCartMutation,
  updateItemsMutation,
  updateOrderFormMutation,
  updateItemsSentToServerMutation,
} from './localState/mutations'

import createLocalState, { ITEMS_STATUS } from './localState'

import minicart from './minicart.css'

const DEFAULT_LABEL_CLASSES = ''
const DEFAULT_ICON_CLASSES = 'gray'

/**
 * Minicart component
 */
class MiniCart extends Component {
  static propTypes = {
    ...MiniCartPropTypes,
    intl: intlShape.isRequired,
    showToast: PropTypes.func.isRequired,
  }

  static defaultProps = {
    labelClasses: DEFAULT_LABEL_CLASSES,
    iconClasses: DEFAULT_ICON_CLASSES,
  }

  state = {
    openContent: false,
    updatingOrderForm: false,
    offline: false,
  }

  updateStatus = () => {
    if (navigator) {
      this.setState({ offline: !pathOr(true, ['onLine'], navigator) })
    }
  }

  saveDataIntoLocalStorage = () => {
    if (localStorage) {
      const clientItems = this.getModifiedItemsOnly()
      localStorage.setItem('minicart', JSON.stringify(clientItems))
      const clientOrderForm = pathOr(
        path(['data', 'orderForm'], this.props),
        ['linkState', 'orderForm'],
        this.props
      )
      localStorage.setItem('orderForm', JSON.stringify(clientOrderForm))
    }
  }

  getDataFromLocalStorage = () => {
    try {
      if (localStorage) {
        const minicart = JSON.parse(localStorage.getItem('minicart'))
        const orderForm = JSON.parse(localStorage.getItem('orderForm'))
        return { minicart, orderForm }
      }
      return {}
    } catch (err) {
      return {}
    }
  }

  async componentDidMount() {
    if (window) {
      window.addEventListener('online', this.updateStatus)
      window.addEventListener('offline', this.updateStatus)
    }
    this.updateStatus()

    if (localStorage) {
      const { minicart, orderForm } = this.getDataFromLocalStorage()
      if (orderForm && !path(['data', 'orderForm'], this.props)) {
        await this.props.updateOrderForm(orderForm)
        localStorage.removeItem('orderForm')
      }
      if (minicart && minicart.length) {
        await this.props.addToLinkStateCart(minicart)
        localStorage.removeItem('minicart')
      }
    }
  }

  componentWillUnmount() {
    if (window) {
      window.removeEventListener('online', this.updateStatus)
      window.removeEventListener('offline', this.updateStatus)
    }
  }

  async componentDidUpdate(prevProps) {
    if (!this.state.offline) {
      await this.handleItemsUpdate()
      this.handleOrderFormUpdate(prevProps)
      if (localStorage) {
        localStorage.removeItem('minicart')
        localStorage.removeItem('orderForm')
      }
    } else {
      this.saveDataIntoLocalStorage()
    }
  }

  getModifiedItemsOnly = () => {
    const clientItems = pathOr([], ['linkState', 'minicartItems'], this.props)
    return clientItems.filter(
      ({ localStatus }) => localStatus === ITEMS_STATUS.MODIFIED
    )
  }

  handleItemsUpdate = async () => {
    const modifiedItems = this.getModifiedItemsOnly()
    if (
      modifiedItems.length &&
      !this.state.updatingOrderForm &&
      this.props.data.orderForm
    ) {
      return this.handleItemsDifference(modifiedItems)
    }
  }

  partitionItemsAddUpdate = clientItems => {
    const isNotInCart = item => item.cartIndex == null
    return partition(isNotInCart, clientItems)
  }

  handleItemsDifference = modifiedItems => {
    this.setState({ updatingOrderForm: true }, () =>
      this.sendModifiedItemsToServer(modifiedItems)
    )
  }

  sendModifiedItemsToServer = async modifiedItems => {
    const { showToast, intl, updateItemsSentToServer } = this.props
    const [itemsToAdd, itemsToUpdate] = this.partitionItemsAddUpdate(
      modifiedItems
    )
    await updateItemsSentToServer()
    const pickProps = map(
      pick(['id', 'index', 'quantity', 'seller', 'options'])
    )
    try {
      const updateItemsResponse = await this.updateItems(
        pickProps(itemsToUpdate)
      )
      const removedItems = itemsToUpdate.filter(
        ({ quantity }) => quantity === 0
      )
      if (removedItems.length) {
        this.props.push({
          event: 'removeFromCart',
          items: removedItems,
        })
      }
      const addItemsResponse = await this.addItems(pickProps(itemsToAdd))

      if (itemsToAdd.length > 0) {
        this.props.push({
          event: 'addToCart',
          items: map(this.getAddToCartEventItems, itemsToAdd),
        })
      }
      const newModifiedItems = this.getModifiedItemsOnly()
      if (newModifiedItems.length > 0) {
        // If there are new modified items in cart, recursively call this function to send requests to server
        return this.sendModifiedItemsToServer(newModifiedItems)
      }

      const newOrderForm = pathOr(
        path(['data', 'addItem'], addItemsResponse),
        ['data', 'updateItems'],
        updateItemsResponse
      )
      await this.props.updateOrderForm(newOrderForm)
    } catch (err) {
      // TODO: Toast error message into Alert
      console.error(err)
      // Rollback items and orderForm
      const orderForm = path(['data', 'orderForm'], this.props)
      showToast({
        message: intl.formatMessage({ id: 'store/minicart.checkout-failure' }),
      })
      await this.props.updateOrderForm(orderForm)
    }
    this.setState({ updatingOrderForm: false })
  }

  handleOrderFormUpdate = async prevProps => {
    const prevOrderForm = path(['data', 'orderForm'], prevProps)
    const orderForm = path(['data', 'orderForm'], this.props)
    if (!prevOrderForm && orderForm) {
      await this.props.updateOrderForm(orderForm)
    }
  }

  addItems = items => {
    const {
      orderForm: { orderFormId },
    } = this.props.data
    if (items.length) {
      return this.props.addToCart({
        variables: { orderFormId, items },
      })
    }
  }

  updateItems = items => {
    const {
      orderForm: { orderFormId },
    } = this.props.data
    if (items.length) {
      return this.props.updateItems({
        variables: { orderFormId, items },
      })
    }
  }

  handleClickButton = event => {
    if (!this.props.hideContent) {
      this.setState({
        openContent: !this.state.openContent,
      })
    }
    event.persist()
  }

  handleUpdateContentVisibility = () => {
    this.setState({
      openContent: false,
    })
  }

  handleClickProduct = detailUrl => {
    this.setState({
      openContent: false,
    })
    const {
      runtime: { navigate },
    } = this.props
    navigate({
      to: detailUrl,
    })
  }

  getFilteredItems = () => {
    const items = pathOr([], ['linkState', 'minicartItems'], this.props)
    return items.filter(shouldShowItem)
  }

  getAddToCartEventItems = ({
    id: skuId,
    skuName: variant,
    sellingPrice: price,
    ...restSkuItem
  }) => {
    return {
      skuId,
      variant,
      price,
      ...pick(['brand', 'name', 'quantity'], restSkuItem),
    }
  }

  render() {
    const { openContent } = this.state
    const {
      labelMiniCartEmpty,
      labelButtonFinishShopping,
      iconClasses,
      iconSize,
      iconLabel,
      labelClasses,
      showDiscount,
      data,
      type,
      hideContent,
      showShippingCost,
      linkState: { minicartItems: items, orderForm },
    } = this.props

    const itemsToShow = this.getFilteredItems()
    const quantity = itemsToShow.length

    const isSizeLarge =
      (type && type === 'sidebar') ||
      isMobile ||
      (window && window.innerWidth <= 480)

    const miniCartContent = (
      <MiniCartContent
        isSizeLarge={isSizeLarge}
        itemsToShow={itemsToShow}
        orderForm={{
          ...orderForm,
          items,
        }}
        loading={data.loading}
        showDiscount={showDiscount}
        labelMiniCartEmpty={labelMiniCartEmpty}
        labelButton={labelButtonFinishShopping}
        onClickProduct={this.handleClickProduct}
        onClickAction={this.handleUpdateContentVisibility}
        showShippingCost={showShippingCost}
        updatingOrderForm={this.state.updatingOrderForm}
      />
    )

    const iconLabelClasses = classNames(
      `${minicart.label} dn-m db-l t-action--small ${labelClasses}`,
      {
        pl6: quantity > 0,
        pl4: quantity <= 0,
      }
    )

    return (
      <aside
        className={`${minicart.container} relative fr flex items-center`}
        ref={e => (this.iconRef = e)}
      >
        <div className="flex flex-column">
          <Button
            variation="tertiary"
            icon
            onClick={event => this.handleClickButton(event)}
          >
            <span className="flex items-center">
              <span className={`relative ${iconClasses}`}>
                <IconCart size={iconSize} />
                {quantity > 0 && (
                  <span
                    className={`${
                      minicart.badge
                    } c-on-emphasis absolute t-mini bg-emphasis br4 w1 h1 pa1 flex justify-center items-center lh-solid`}
                  >
                    {quantity}
                  </span>
                )}
              </span>
              {iconLabel && (
                <span className={iconLabelClasses}>{iconLabel}</span>
              )}
            </span>
          </Button>
          {!hideContent &&
            (isSizeLarge ? (
              <Sidebar
                quantity={quantity}
                iconSize={iconSize}
                onOutsideClick={this.handleUpdateContentVisibility}
                isOpen={openContent}
              >
                {miniCartContent}
              </Sidebar>
            ) : (
              openContent && (
                <Popup onOutsideClick={this.handleUpdateContentVisibility}>
                  {miniCartContent}
                </Popup>
              )
            ))}
        </div>
      </aside>
    )
  }
}

MiniCart.schema = {
  title: 'admin/editor.minicart.title',
  description: 'admin/editor.minicart.description',
  type: 'object',
  properties: {
    type: {
      title: 'admin/editor.minicart.type.title',
      type: 'string',
      default: 'popup',
      enum: ['popup', 'sidebar'],
      enumNames: [
        'admin/editor.minicart.type.popup',
        'admin/editor.minicart.type.sidebar',
      ],
      widget: {
        'ui:widget': 'radio',
        'ui:options': {
          inline: true,
        },
      },
      isLayout: true,
    },
    showDiscount: {
      title: 'admin/editor.minicart.showDiscount.title',
      type: 'boolean',
      isLayout: true,
    },
    labelMiniCartEmpty: {
      title: 'admin/editor.minicart.labelMiniCartEmpty.title',
      type: 'string',
      isLayout: false,
    },
    labelButtonFinishShopping: {
      title: 'admin/editor.minicart.labelButtonFinishShopping.title',
      type: 'string',
      isLayout: false,
    },
  },
}

const withLinkStateMinicartQuery = graphql(fullMinicartQuery, {
  options: () => ({ ssr: false }),
  props: ({ data: { minicart } }) => ({
    linkState: {
      minicartItems: minicart && JSON.parse(minicart.items),
      orderForm: minicart && JSON.parse(minicart.orderForm),
    },
  }),
})

const withLinkStateUpdateItemsMutation = graphql(updateItemsMutation, {
  name: 'updateLinkStateItems',
  props: ({ updateLinkStateItems }) => ({
    updateLinkStateItems: items =>
      updateLinkStateItems({ variables: { items } }),
  }),
})

const withLinkStateAddToCartMutation = graphql(addToCartMutation, {
  name: 'addToLinkStateCart',
  props: ({ addToLinkStateCart }) => ({
    addToLinkStateCart: items => addToLinkStateCart({ variables: { items } }),
  }),
})

const withLinkStateUpdateOrderFormMutation = graphql(updateOrderFormMutation, {
  name: 'updateOrderForm',
  props: ({ updateOrderForm }) => ({
    updateOrderForm: orderForm => updateOrderForm({ variables: { orderForm } }),
  }),
})

const withLinkStateUpdateItemsSentToServerMutation = graphql(
  updateItemsSentToServerMutation,
  {
    name: 'updateItemsSentToServer',
    props: ({ updateItemsSentToServer }) => ({
      updateItemsSentToServer: () => updateItemsSentToServer(),
    }),
  }
)

const withLinkState = WrappedComponent => {
  const Component = ({ client, ...props }) => {
    useEffect(() => {
      const { resolvers, initialState } = createLocalState(client)
      client.addResolvers(resolvers)
      // Add the initial state to if there is not there
      try {
        client.readQuery({ query: fullMinicartQuery })
      } catch (err) {
        client.writeData({ data: initialState })
      }
    }, [])

    return <WrappedComponent client={client} {...props} />
  }

  Component.displayName = `withLinkState(${WrappedComponent.displayName})`
  Component.propTypes = {
    client: PropTypes.object.isRequired,
  }
  return hoistNonReactStatics(Component, WrappedComponent)
}

export default compose(
  graphql(orderForm, { options: () => ({ ssr: false }) }),
  graphql(addToCart, { name: 'addToCart' }),
  graphql(updateItems, { name: 'updateItems' }),
  withApollo,
  withLinkState,
  withLinkStateMinicartQuery,
  withLinkStateUpdateItemsMutation,
  withLinkStateAddToCartMutation,
  withLinkStateUpdateOrderFormMutation,
  withLinkStateUpdateItemsSentToServerMutation,
  withRuntimeContext,
  Pixel,
  withToast,
  injectIntl
)(MiniCart)
