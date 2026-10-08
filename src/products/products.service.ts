import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'uuid';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginationDto } from '../common/dtos/pagination.dto';
import { ProductImage, Product } from './entities';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger('ProductsService');
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,

    @InjectRepository(ProductImage)
    private readonly productImageRepository: Repository<ProductImage>,

    private readonly dataSource: DataSource,
  ) {}

  async create(createProductDto: CreateProductDto) {
    try {
      const { images = [], ...productObject } = createProductDto;

      const product = this.productRepository.create({
        ...productObject,
        images: images.map((image) =>
          this.productImageRepository.create({ url: image }),
        ),
      });
      await this.productRepository.save(product);
      return product;
    } catch (error) {
      this.handleExceptions(error);
    }
  }

  async findAll(paginationDto: PaginationDto) {
    const { limit = 10, offset = 0 } = paginationDto;

    const products = await this.productRepository.find({
      take: limit,
      skip: offset,
      relations: {
        images: true,
      },
    });

    return products.map((product) => ({
      ...product,
      images: product.images?.map((img) => img.url),
    }));
  }

  async findOne(term: string) {
    let product = null;
    try {
      if (validate(term)) {
        product = await this.productRepository.findOneBy({ id: term });
      } else {
        const queryBuiler = this.productRepository.createQueryBuilder('prod');
        product = await queryBuiler
          .where('UPPER(title) = :title or slug = :slug', {
            title: term.toUpperCase(),
            slug: term.toLowerCase(),
          })
          .leftJoinAndSelect('prod.images', 'prodImages')
          .getOne();
      }
    } catch (error) {
      this.logger.error(error);
    }

    if (!product)
      throw new NotFoundException(`Product with term:${term} not found`);

    return product;
  }

  async findOnePlain( term: string ) {
    const { images = [], ...rest } = await this.findOne( term );
    return {
      ...rest,
      images: images.map( image => image.url )
    }
  }

  async update( id: string, updateProductDto: UpdateProductDto ) {

    const { images, ...toUpdate } = updateProductDto;


    const product = await this.productRepository.preload({ id, ...toUpdate });

    if ( !product ) throw new NotFoundException(`Product with id: ${ id } not found`);

    // Create query runner
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

      if( images ) {
        await queryRunner.manager.delete( ProductImage, { product: { id } });

        product.images = images.map( 
          image => this.productImageRepository.create({ url: image }) 
        )
      }
      
      // await this.productRepository.save( product );
      await queryRunner.manager.save( product );

      await queryRunner.commitTransaction();
      await queryRunner.release();

      return this.findOne( id );
      
    } catch (error) {

      await queryRunner.rollbackTransaction();
      await queryRunner.release();
      this.handleExceptions(error);
    }

  }

  async remove(id: string) {
    const result: any = await this.productRepository.delete({ id });
    if (!result) throw new NotFoundException(`Product with id:${id} not found`);
    return result;
  }

  async deleteAllProducts() {
    const query = this.productRepository.createQueryBuilder('product');

    try {
      return await query
        .delete()
        .from('product')
        .execute();

    } catch (error) {
      this.handleExceptions(error);
    }

  }

  private handleExceptions(error: any) {
    if (error.code === '23505') {
      throw new BadRequestException(error.detail);
    } else {
      this.logger.error(error);
      throw new InternalServerErrorException('Error al guardar producto');
    }
  }
}
